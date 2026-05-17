import { logger } from "@/server/logger";
import { isAbortError, throwIfAborted } from "@/server/image/abort";
import {
  createImageError,
  getImageErrorMeta,
  ImageGenerationError,
} from "@/server/providers/openai/image-errors";

import {
  downloadAsBase64,
  fetchDownloadUrl,
  normalizePollWaitMs,
  pollImageResult,
} from "./result-download-adapter";
import {
  buildNoImageReturnedError,
  parseSsePayload,
} from "./result-parser";
import {
  cleanToken,
  maskAccessToken,
  type ChatGptResultSession,
} from "./result-shared";

type GeneratedDownloadItem = {
  b64_json: string;
  revised_prompt: string | undefined;
  file_id: string;
  conversation_id: string | undefined;
  parent_message_id: string | undefined;
};

type GeneratedDownloadFailure = {
  fileId: string;
  message: string;
  meta: ReturnType<typeof getImageErrorMeta>;
  statusCode?: number;
};

const MAX_DOWNLOAD_RETRIES = 3;
const DOWNLOAD_FALLBACK_POLL_MS = 15000;

function getFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "unknown download error");
}

function shouldPollAfterDownloadFailures(failures: GeneratedDownloadFailure[]) {
  return failures.some((failure) =>
    failure.statusCode === 404 ||
    failure.message.includes("failed to get download url"),
  );
}

async function downloadGeneratedItemWithRetry(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileId: string,
  revisedPrompt?: string,
  parentMessageId?: string,
  signal?: AbortSignal,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt += 1) {
    throwIfAborted(signal);
    try {
      const url = await fetchDownloadUrl(session, accessToken, deviceId, conversationId, fileId, signal);
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
      const b64 = await downloadAsBase64(session, url, accessToken, deviceId, signal);
      logger.info("openai-client", "generate-image:file-downloaded", {
        conversationId,
        fileId,
        base64Length: b64.length,
        token: maskAccessToken(accessToken),
        attempt: attempt + 1,
      });
      return {
        b64_json: b64,
        revised_prompt: revisedPrompt,
        file_id: fileId,
        conversation_id: conversationId || undefined,
        parent_message_id: parentMessageId || undefined,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      const message = getFailureMessage(error);
      const errorMeta = getImageErrorMeta(error);
      if (error instanceof ImageGenerationError && error.kind === "poll_rate_limited") {
        throw error;
      }
      if (attempt < MAX_DOWNLOAD_RETRIES) {
        logger.warn("openai-client", "generate-image:file-download-retry", {
          conversationId,
          fileId,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          error: message.slice(0, 300),
          token: maskAccessToken(accessToken),
          ...errorMeta,
        });
        continue;
      }
    }
  }

  throw lastError;
}

async function downloadGeneratedItems(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileIds: string[],
  revisedPrompt?: string,
  parentMessageId?: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const downloadResults = await Promise.allSettled(
    fileIds.map((fileId) =>
      downloadGeneratedItemWithRetry(session, accessToken, deviceId, conversationId, fileId, revisedPrompt, parentMessageId, signal),
    ),
  );

  const aborted = downloadResults.find((result) => result.status === "rejected" && isAbortError(result.reason));
  if (aborted?.status === "rejected") {
    throw aborted.reason;
  }
  throwIfAborted(signal);

  const failures: GeneratedDownloadFailure[] = [];
  const items = downloadResults
    .filter((r): r is PromiseFulfilledResult<GeneratedDownloadItem> => r.status === "fulfilled")
    .map((r) => r.value);

  downloadResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      return;
    }
    const fileId = fileIds[index] ?? "";
    const failure = {
      fileId,
      message: getFailureMessage(result.reason),
      meta: getImageErrorMeta(result.reason),
      statusCode: result.reason instanceof ImageGenerationError ? result.reason.statusCode : undefined,
    };
    failures.push(failure);
    logger.warn("openai-client", "generate-image:file-download-failed", {
      conversationId,
      fileId,
      error: failure.message.slice(0, 300),
      token: maskAccessToken(accessToken),
      ...failure.meta,
    });
  });

  return { items, failures };
}

async function downloadGeneratedItemsWithConversationFallback(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileIds: string[],
  revisedPrompt?: string,
  parentMessageId?: string,
  fallbackWaitMs = DOWNLOAD_FALLBACK_POLL_MS,
  signal?: AbortSignal,
) {
  const firstAttempt = await downloadGeneratedItems(
    session,
    accessToken,
    deviceId,
    conversationId,
    fileIds,
    revisedPrompt,
    parentMessageId,
    signal,
  );
  if (firstAttempt.items.length > 0 || !conversationId) {
    return {
      ...firstAttempt,
      fileIds,
    };
  }
  if (!shouldPollAfterDownloadFailures(firstAttempt.failures)) {
    return {
      ...firstAttempt,
      fileIds,
    };
  }

  let polledFileIds: string[];
  let effectiveParentMessageId = parentMessageId;
  try {
    const polled = await pollImageResult(session, accessToken, deviceId, conversationId, { maxWaitMs: fallbackWaitMs, signal });
    polledFileIds = polled.fileIds;
    effectiveParentMessageId = polled.parentMessageId || effectiveParentMessageId;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    logger.warn("openai-client", "generate-image:file-download-fallback-poll-failed", {
      conversationId,
      error: getFailureMessage(error).slice(0, 300),
      token: maskAccessToken(accessToken),
    });
    return {
      ...firstAttempt,
      fileIds,
    };
  }
  const fallbackFileIds = polledFileIds.filter((fileId) => !fileIds.includes(fileId));
  if (fallbackFileIds.length === 0) {
    return {
      ...firstAttempt,
      fileIds,
    };
  }

  logger.warn("openai-client", "generate-image:file-download-fallback", {
    conversationId,
    originalFileCount: fileIds.length,
    fallbackFileCount: fallbackFileIds.length,
    token: maskAccessToken(accessToken),
  });

  const fallbackAttempt = await downloadGeneratedItems(
    session,
    accessToken,
    deviceId,
    conversationId,
    fallbackFileIds,
    revisedPrompt,
    effectiveParentMessageId,
    signal,
  );
  return {
    items: fallbackAttempt.items,
    failures: fallbackAttempt.items.length > 0
      ? fallbackAttempt.failures
      : [...firstAttempt.failures, ...fallbackAttempt.failures],
    fileIds: fallbackFileIds,
  };
}

export async function collectGeneratedItems(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  rawResponseText: string,
  revisedPrompt: string,
  options: { signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const parsed = parseSsePayload(rawResponseText);
  const conversationId = parsed.conversationId || "";
  let parentMessageId = parsed.parentMessageId || "";
  let fileIds = parsed.fileIds;
  logger.info("openai-client", "generate-image:sse-parsed", {
    conversationId,
    fileCount: fileIds.length,
    hasParentMessageId: Boolean(parentMessageId),
    textPreview: parsed.text.slice(0, 200),
  });
  const textReply = parsed.text?.trim();
  if (conversationId && fileIds.length === 0 && textReply) {
    const nextError = buildNoImageReturnedError(textReply);
    nextError.upstreamConversationId = conversationId || nextError.upstreamConversationId;
    nextError.upstreamParentMessageId = parentMessageId || nextError.upstreamParentMessageId;
    if (!nextError.retryable) {
      const logEvent = nextError.kind === "input_blocked"
        ? "generate-image:input-blocked"
        : nextError.kind === "source_invalid"
          ? "generate-image:source-invalid"
          : "generate-image:no-file-ids-short-circuit";
      logger.warn("openai-client", logEvent, {
        conversationId,
        token: maskAccessToken(accessToken),
        ...getImageErrorMeta(nextError),
        textPreview: textReply.slice(0, 240),
      });
      throw nextError;
    }
  }
  if (conversationId && fileIds.length === 0) {
    const polled = await pollImageResult(session, accessToken, deviceId, conversationId, { signal: options.signal });
    fileIds = polled.fileIds;
    parentMessageId = polled.parentMessageId || parentMessageId;
  }
  if (fileIds.length === 0) {
    logger.error("openai-client", "generate-image:no-file-ids", {
      conversationId,
      textPreview: parsed.text.slice(0, 240),
      token: maskAccessToken(accessToken),
    });
    if (textReply) {
      const nextError = buildNoImageReturnedError(textReply);
      nextError.upstreamConversationId = conversationId || nextError.upstreamConversationId;
      nextError.upstreamParentMessageId = parentMessageId || nextError.upstreamParentMessageId;
      throw nextError;
    }
    throw createImageError("no image returned from upstream", {
      kind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: conversationId,
      upstreamParentMessageId: parentMessageId || undefined,
    });
  }

  const {
    items: successItems,
    failures,
    fileIds: attemptedFileIds,
  } = await downloadGeneratedItemsWithConversationFallback(
    session,
    accessToken,
    deviceId,
    conversationId,
    fileIds,
    revisedPrompt,
    parentMessageId,
    undefined,
    options.signal,
  );

  logger.info("openai-client", "generate-image:done", {
    conversationId,
    fileCount: fileIds.length,
    successCount: successItems.length,
    token: maskAccessToken(accessToken),
  });

  if (successItems.length === 0) {
    const detail = failures[0]?.message;
    throw createImageError(detail ? `failed to download any images: ${detail}` : "failed to download any images", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: conversationId,
      upstreamParentMessageId: parentMessageId || undefined,
      fileIds: attemptedFileIds,
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
    parentMessageId?: string;
    fileIds?: string[];
    revisedPrompt?: string;
    waitMs?: number;
    sourceAccountId?: string;
    signal?: AbortSignal;
  },
) {
  const conversationId = cleanToken(recovery.conversationId);
  const waitMs = normalizePollWaitMs(recovery.waitMs ?? 60000);
  throwIfAborted(recovery.signal);
  if (!conversationId) {
    throw createImageError("conversation id is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }

  let fileIds = (recovery.fileIds ?? []).map((item) => cleanToken(item)).filter(Boolean);
  let parentMessageId = cleanToken(recovery.parentMessageId);
  if (fileIds.length === 0) {
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      throwIfAborted(recovery.signal);
      const polled = await pollImageResult(session, accessToken, deviceId, conversationId, {
        maxWaitMs: Math.max(3000, waitMs - (Date.now() - started)),
        signal: recovery.signal,
      });
      fileIds = polled.fileIds;
      parentMessageId = polled.parentMessageId || parentMessageId;
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
      upstreamParentMessageId: parentMessageId || undefined,
      sourceAccountId: recovery.sourceAccountId,
    });
  }

  const {
    items: successItems,
    failures,
    fileIds: attemptedFileIds,
  } = await downloadGeneratedItemsWithConversationFallback(
    session,
    accessToken,
    deviceId,
    conversationId,
    fileIds,
    recovery.revisedPrompt,
    parentMessageId || undefined,
    waitMs,
    recovery.signal,
  );

  if (successItems.length === 0) {
    const detail = failures[0]?.message;
    throw createImageError(detail ? `failed to download any images: ${detail}` : "failed to download any images", {
      kind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: conversationId,
      upstreamParentMessageId: parentMessageId || undefined,
      sourceAccountId: recovery.sourceAccountId,
      fileIds: attemptedFileIds,
    });
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: successItems,
  };
}
