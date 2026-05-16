import { logger } from "@/server/logger";
import { abortableDelay, isAbortError, throwIfAborted } from "@/server/image/abort";
import {
  createImageError,
} from "@/server/providers/openai/image-errors";

import {
  BASE_URL,
  maskAccessToken,
  type ChatGptResultSession,
} from "./result-shared";
import { extractImageIds } from "./result-parser";

export async function pollImageIds(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  options: { maxWaitMs?: number; signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const started = Date.now();
  const maxWaitMs = Math.max(3000, options.maxWaitMs ?? 180000);
  logger.info("openai-client", "poll-image-ids:start", {
    conversationId,
    deviceId,
    token: maskAccessToken(accessToken),
    maxWaitMs,
  });
  while (Date.now() - started < maxWaitMs) {
    throwIfAborted(options.signal);
    let response: Response;
    try {
      response = await session.fetch(`${BASE_URL}/backend-api/conversation/${conversationId}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "oai-device-id": deviceId,
          accept: "*/*",
        },
        timeoutMs: 30000,
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "poll image ids failed";
      logger.warn("openai-client", "poll-image-ids:error", {
        conversationId,
        error: message.slice(0, 300),
        elapsedMs: Date.now() - started,
      });
      throw createImageError(message, {
        kind: "accepted_pending",
        retryAction: "resume_polling",
        retryable: true,
        stage: "poll",
        upstreamConversationId: conversationId,
      });
    }

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

    await abortableDelay(3000, options.signal);
  }

  logger.warn("openai-client", "poll-image-ids:timeout", {
    conversationId,
    elapsedMs: Date.now() - started,
    maxWaitMs,
  });
  return [] as string[];
}

export async function fetchDownloadUrl(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileId: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
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
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "failed to get download url";
    logger.warn("openai-client", "download-url:error", {
      conversationId,
      fileId,
      error: message.slice(0, 300),
    });
    throw createImageError(message, {
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

function buildDownloadHeaders(downloadUrl: string, accessToken: string, deviceId: string): HeadersInit | undefined {
  let parsed: URL;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    return undefined;
  }
  if (parsed.origin !== BASE_URL) {
    return undefined;
  }
  return {
    authorization: `Bearer ${accessToken}`,
    "oai-device-id": deviceId,
  };
}

export async function downloadAsBase64(
  session: ChatGptResultSession,
  downloadUrl: string,
  accessToken: string,
  deviceId: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await session.fetch(downloadUrl, {
      headers: buildDownloadHeaders(downloadUrl, accessToken, deviceId),
      timeoutMs: 60000,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
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
