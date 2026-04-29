import { logger } from "@/server/logger";
import {
  buildHttpImageError,
  createImageError,
  isInputBlockedMessage,
  normalizeUpstreamErrorMessage,
} from "@/server/providers/openai-image-errors";

const BASE_URL = "https://chatgpt.com";

type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type ChatGptResultSession = {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
};

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

function maskAccessToken(accessToken: string) {
  const normalized = cleanToken(accessToken);
  if (!normalized) {
    return "";
  }
  return normalized.length <= 16 ? normalized : `${normalized.slice(0, 16)}...`;
}
function parseSsePayload(raw: string) {
  const fileIds: string[] = [];
  let conversationId = "";
  const textParts: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    for (const [prefix, storedPrefix] of [
      ["file-service://", ""],
      ["sediment://", "sed:"],
    ] as const) {
      let cursor = 0;
      while (cursor >= 0) {
        const start = payload.indexOf(prefix, cursor);
        if (start < 0) {
          break;
        }
        cursor = start + prefix.length;
        const tail = payload.slice(cursor);
        const normalized = storedPrefix + (tail.match(/^[A-Za-z0-9_-]+/)?.[0] ?? "");
        if (normalized && !fileIds.includes(normalized)) {
          fileIds.push(normalized);
        }
      }
    }

    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      conversationId = String(json.conversation_id || conversationId);
      const nested = json.v;
      if (nested && typeof nested === "object") {
        conversationId = String((nested as Record<string, unknown>).conversation_id || conversationId);
      }
      const message = (json.message as Record<string, unknown> | undefined) ?? {};
      const content = (message.content as Record<string, unknown> | undefined) ?? {};
      if (content.content_type === "text" && Array.isArray(content.parts) && content.parts.length > 0) {
        textParts.push(String(content.parts[0] || ""));
      }
    } catch {
      continue;
    }
  }

  return {
    conversationId,
    fileIds,
    text: textParts.join(""),
  };
}

function buildNoImageReturnedError(textReply: string) {
  const normalized = cleanToken(textReply);
  const lower = normalized.toLowerCase();
  if (isInputBlockedMessage(normalized)) {
    return createImageError(normalizeUpstreamErrorMessage(normalized), {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "submit",
    });
  }
  if (
    lower.includes("upload") ||
    lower.includes("please upload") ||
    normalized.includes("请上传") ||
    normalized.includes("源图")
  ) {
    return createImageError("上游未识别到上传源图，未返回图片结果", {
      kind: "source_invalid",
      retryAction: "resubmit",
      retryable: false,
      stage: "submit",
    });
  }
  return createImageError("上游未返回图片结果", {
    kind: "accepted_pending",
    retryAction: "resume_polling",
    retryable: true,
    stage: "poll",
  });
}

function extractImageIds(mapping: Record<string, unknown>) {
  const fileIds: string[] = [];
  for (const node of Object.values(mapping)) {
    const message = ((node as Record<string, unknown> | undefined)?.message ?? {}) as Record<string, unknown>;
    const author = (message.author ?? {}) as Record<string, unknown>;
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const content = (message.content ?? {}) as Record<string, unknown>;

    if (author.role !== "tool" || metadata.async_task_type !== "image_gen" || content.content_type !== "multimodal_text") {
      continue;
    }

    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      const pointer = String((part as Record<string, unknown>)?.asset_pointer || "");
      if (pointer.startsWith("file-service://")) {
        const fileId = pointer.replace("file-service://", "");
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      } else if (pointer.startsWith("sediment://")) {
        const fileId = `sed:${pointer.replace("sediment://", "")}`;
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      }
    }
  }
  return fileIds;
}

async function pollImageIds(session: ChatGptResultSession, accessToken: string, deviceId: string, conversationId: string) {
  const started = Date.now();
  logger.info("openai-client", "poll-image-ids:start", {
    conversationId,
    deviceId,
    token: maskAccessToken(accessToken),
  });
  while (Date.now() - started < 180000) {
    const response = await session.fetch(`${BASE_URL}/backend-api/conversation/${conversationId}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        accept: "*/*",
      },
      timeoutMs: 30000,
    });

    if (response.ok) {
      const payload = (await response.json()) as { mapping?: Record<string, unknown> };
      const fileIds = extractImageIds(payload.mapping || {});
      if (fileIds.length > 0) {
        logger.info("openai-client", "poll-image-ids:done", {
          conversationId,
          fileCount: fileIds.length,
          elapsedMs: Date.now() - started,
        });
        return fileIds;
      }
    } else {
      logger.warn("openai-client", "poll-image-ids:non-ok", {
        conversationId,
        status: response.status,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  logger.warn("openai-client", "poll-image-ids:timeout", {
    conversationId,
    elapsedMs: Date.now() - started,
  });
  return [] as string[];
}


async function fetchDownloadUrl(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileId: string,
) {
  const isSediment = fileId.startsWith("sed:");
  const rawId = isSediment ? fileId.slice(4) : fileId;
  const endpoint = isSediment
    ? `${BASE_URL}/backend-api/conversation/${conversationId}/attachment/${rawId}/download`
    : `${BASE_URL}/backend-api/files/${rawId}/download`;
  let response: Response;
  try {
    response = await session.fetch(endpoint, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
      },
      timeoutMs: 30000,
    });
  } catch (error) {
    throw createImageError(error instanceof Error ? error.message : "failed to get download url", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: conversationId,
      fileIds: [fileId],
    });
  }

  if (!response.ok) {
    logger.warn("openai-client", "download-url:failed", {
      conversationId,
      fileId,
      status: response.status,
    });
    return "";
  }

  const payload = (await response.json()) as { download_url?: string };
  const downloadUrl = String(payload.download_url || "");
  logger.info("openai-client", "download-url:done", {
    conversationId,
    fileId,
    hasUrl: Boolean(downloadUrl),
  });
  return downloadUrl;
}

async function downloadAsBase64(session: ChatGptResultSession, downloadUrl: string) {
  let response: Response;
  try {
    response = await session.fetch(downloadUrl, { timeoutMs: 60000 });
  } catch (error) {
    throw createImageError(error instanceof Error ? error.message : "download image failed", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
    });
  }
  if (!response.ok) {
    logger.error("openai-client", "download-image:failed", {
      status: response.status,
      downloadUrl,
    });
    throw createImageError("download image failed", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      statusCode: response.status,
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    logger.error("openai-client", "download-image:empty", {
      downloadUrl,
    });
    throw createImageError("download image failed", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
    });
  }
  logger.info("openai-client", "download-image:done", {
    downloadUrl,
    bytes: bytes.length,
  });
  return bytes.toString("base64");
}

export async function collectGeneratedItems(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  rawResponseText: string,
  revisedPrompt: string,
) {
  const parsed = parseSsePayload(rawResponseText);
  const conversationId = parsed.conversationId || "";
  let fileIds = parsed.fileIds;
  logger.info("openai-client", "generate-image:sse-parsed", {
    conversationId,
    fileCount: fileIds.length,
    textPreview: parsed.text.slice(0, 200),
  });
  if (conversationId && fileIds.length === 0) {
    fileIds = await pollImageIds(session, accessToken, deviceId, conversationId);
  }
  if (fileIds.length === 0) {
    logger.error("openai-client", "generate-image:no-file-ids", {
      conversationId,
      textPreview: parsed.text.slice(0, 240),
      token: maskAccessToken(accessToken),
    });
    const textReply = parsed.text?.trim();
    if (textReply) {
      const nextError = buildNoImageReturnedError(textReply);
      nextError.upstreamConversationId = conversationId || nextError.upstreamConversationId;
      throw nextError;
    }
    throw createImageError("no image returned from upstream", {
      kind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: conversationId,
    });
  }

  const downloadResults = await Promise.allSettled(
    fileIds.map(async (fileId) => {
      const url = await fetchDownloadUrl(session, accessToken, deviceId, conversationId, fileId);
      if (!url) {
        throw createImageError(`failed to get download url for file ${fileId}`, {
          kind: "result_fetch_failed",
          retryAction: "retry_download",
          retryable: true,
          stage: "download",
          upstreamConversationId: conversationId,
          fileIds: [fileId],
        });
      }
      const b64 = await downloadAsBase64(session, url);
      logger.info("openai-client", "generate-image:file-downloaded", {
        conversationId,
        fileId,
        base64Length: b64.length,
        token: maskAccessToken(accessToken),
      });
      return {
        b64_json: b64,
        revised_prompt: revisedPrompt,
        file_id: fileId,
        conversation_id: conversationId || undefined,
      };
    }),
  );

  const successItems = downloadResults
    .filter((r): r is PromiseFulfilledResult<{ b64_json: string; revised_prompt: string; file_id: string; conversation_id: string | undefined }> => r.status === "fulfilled")
    .map((r) => r.value);

  logger.info("openai-client", "generate-image:done", {
    conversationId,
    fileCount: fileIds.length,
    successCount: successItems.length,
    token: maskAccessToken(accessToken),
  });

  if (successItems.length === 0) {
    throw createImageError("failed to download any images", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: conversationId,
      fileIds,
    });
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: successItems,
  };
}

export async function recoverGeneratedItems(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  recovery: {
    conversationId: string;
    fileIds?: string[];
    revisedPrompt?: string;
    waitMs?: number;
  },
) {
  const conversationId = cleanToken(recovery.conversationId);
  const waitMs = Math.max(3000, recovery.waitMs ?? 60000);
  if (!conversationId) {
    throw createImageError("conversation id is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }

  let fileIds = (recovery.fileIds ?? []).map((item) => cleanToken(item)).filter(Boolean);
  if (fileIds.length === 0) {
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      fileIds = await pollImageIds(session, accessToken, deviceId, conversationId);
      if (fileIds.length > 0) {
        break;
      }
    }
  }

  if (fileIds.length === 0) {
    throw createImageError("上游任务仍在处理中，请稍后继续等待", {
      kind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: conversationId,
    });
  }

  const downloadResults = await Promise.allSettled(
    fileIds.map(async (fileId) => {
      const url = await fetchDownloadUrl(session, accessToken, deviceId, conversationId, fileId);
      if (!url) {
        throw createImageError(`failed to get download url for file ${fileId}`, {
          kind: "result_fetch_failed",
          retryAction: "retry_download",
          retryable: true,
          stage: "download",
          upstreamConversationId: conversationId,
          fileIds: [fileId],
        });
      }
      const b64 = await downloadAsBase64(session, url);
      return {
        b64_json: b64,
        revised_prompt: recovery.revisedPrompt,
        file_id: fileId,
        conversation_id: conversationId,
      };
    }),
  );

  const successItems = downloadResults
    .filter((r): r is PromiseFulfilledResult<{ b64_json: string; revised_prompt: string | undefined; file_id: string; conversation_id: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  if (successItems.length === 0) {
    throw createImageError("failed to download any images", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: conversationId,
      fileIds,
    });
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: successItems,
  };
}


