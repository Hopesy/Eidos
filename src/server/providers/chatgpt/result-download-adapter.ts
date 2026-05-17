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
import { extractImageResult, isImageGenerationRefusalTitle } from "./result-parser";

const DEFAULT_POLL_DELAY_MS = 3000;
export const POLL_MIN_WAIT_MS = 3000;
export const POLL_MAX_WAIT_MS = 180000;
const RATE_LIMIT_INITIAL_DELAY_MS = 5000;
const RATE_LIMIT_MAX_DELAY_MS = 45000;

type PollNonOkState = {
  attempts: number;
  statusCounts: Record<string, number>;
  lastStatus?: number;
  lastBodyPreview?: string;
  lastRetryAfterMs?: number;
};

function parseRetryAfterMs(value: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return undefined;
  }
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.round(seconds * 1000));
  }
  const retryDate = Date.parse(normalized);
  if (!Number.isNaN(retryDate)) {
    return Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.max(0, retryDate - Date.now()));
  }
  return undefined;
}

function calculatePollDelayMs(status: number | undefined, rateLimitStreak: number, retryAfterMs?: number) {
  if (status !== 429) {
    return DEFAULT_POLL_DELAY_MS;
  }
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.max(DEFAULT_POLL_DELAY_MS, retryAfterMs);
  }
  const multiplier = 2 ** Math.max(0, rateLimitStreak - 1);
  return Math.min(RATE_LIMIT_MAX_DELAY_MS, RATE_LIMIT_INITIAL_DELAY_MS * multiplier);
}

export function normalizePollWaitMs(value: unknown) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) ? parsed : POLL_MAX_WAIT_MS;
  return Math.min(POLL_MAX_WAIT_MS, Math.max(POLL_MIN_WAIT_MS, Math.round(candidate)));
}

async function readResponsePreview(response: Response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

function buildPollRateLimitError(conversationId: string, state: PollNonOkState) {
  return createImageError("轮询图片结果被上游限流，请稍后再试", {
    kind: "poll_rate_limited",
    retryAction: "resume_polling",
    retryable: true,
    stage: "poll",
    statusCode: 429,
    upstreamConversationId: conversationId,
    lastPollStatus: state.lastStatus,
    pollStatusCounts: state.statusCounts,
    pollAttempts: state.attempts,
    retryAfterMs: state.lastRetryAfterMs,
    upstreamBodyPreview: state.lastBodyPreview,
  });
}

function buildTitleRefusalError(conversationId: string, title: string) {
  return createImageError("图像生成请求被上游拒绝，请修改提示词后重试", {
    kind: "input_blocked",
    retryAction: "revise_input",
    retryable: false,
    stage: "submit",
    upstreamConversationId: conversationId,
    upstreamBodyPreview: title,
  });
}

export async function pollImageIds(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  options: { maxWaitMs?: number; signal?: AbortSignal } = {},
) {
  return (await pollImageResult(session, accessToken, deviceId, conversationId, options)).fileIds;
}

export async function pollImageResult(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  options: { maxWaitMs?: number; signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const started = Date.now();
  const maxWaitMs = normalizePollWaitMs(options.maxWaitMs ?? POLL_MAX_WAIT_MS);
  logger.info("openai-client", "poll-image-ids:start", {
    conversationId,
    deviceId,
    token: maskAccessToken(accessToken),
    maxWaitMs,
  });
  const nonOkState: PollNonOkState = {
    attempts: 0,
    statusCounts: {},
  };
  let rateLimitStreak = 0;
  while (Date.now() - started < maxWaitMs) {
    throwIfAborted(options.signal);
    let response: Response;
    try {
      const remainingMs = Math.max(1, maxWaitMs - (Date.now() - started));
      response = await session.fetch(`${BASE_URL}/backend-api/conversation/${conversationId}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "oai-device-id": deviceId,
          accept: "*/*",
        },
        timeoutMs: Math.min(30000, remainingMs),
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
      rateLimitStreak = 0;
      const payload = (await response.json()) as { title?: unknown; mapping?: Record<string, unknown> };
      const title = String(payload.title || "").trim();
      if (isImageGenerationRefusalTitle(title)) {
        logger.warn("openai-client", "poll-image-ids:input-blocked", {
          conversationId,
          title,
          elapsedMs: Date.now() - started,
        });
        throw buildTitleRefusalError(conversationId, title);
      }
      const result = extractImageResult(payload.mapping || {});
      const fileIds = result.fileIds;
      if (fileIds.length > 0) {
        logger.info("openai-client", "poll-image-ids:done", {
          conversationId,
          fileCount: fileIds.length,
          hasParentMessageId: Boolean(result.parentMessageId),
          elapsedMs: Date.now() - started,
        });
        return result;
      }
    } else {
      nonOkState.attempts += 1;
      nonOkState.lastStatus = response.status;
      nonOkState.statusCounts[String(response.status)] = (nonOkState.statusCounts[String(response.status)] ?? 0) + 1;
      rateLimitStreak = response.status === 429 ? rateLimitStreak + 1 : 0;
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      nonOkState.lastRetryAfterMs = retryAfterMs;
      nonOkState.lastBodyPreview = await readResponsePreview(response);
      const delayMs = calculatePollDelayMs(response.status, rateLimitStreak, retryAfterMs);
      logger.warn("openai-client", "poll-image-ids:non-ok", {
        conversationId,
        status: response.status,
        attempt: nonOkState.attempts,
        elapsedMs: Date.now() - started,
        retryAfterMs,
        nextDelayMs: delayMs,
        rateLimitStreak,
        bodyPreview: nonOkState.lastBodyPreview,
      });
      const remainingMs = maxWaitMs - (Date.now() - started);
      await abortableDelay(Math.max(0, Math.min(delayMs, remainingMs)), options.signal);
      continue;
    }

    const remainingMs = maxWaitMs - (Date.now() - started);
    await abortableDelay(Math.max(0, Math.min(DEFAULT_POLL_DELAY_MS, remainingMs)), options.signal);
  }

  logger.warn("openai-client", "poll-image-ids:timeout", {
    conversationId,
    elapsedMs: Date.now() - started,
    maxWaitMs,
    lastStatus: nonOkState.lastStatus,
    statusCounts: nonOkState.statusCounts,
    attempts: nonOkState.attempts,
  });
  const rateLimitedCount = nonOkState.statusCounts["429"] ?? 0;
  if (nonOkState.lastStatus === 429 && rateLimitedCount > 0) {
    logger.warn("openai-client", "poll-image-ids:rate-limited", {
      conversationId,
      elapsedMs: Date.now() - started,
      maxWaitMs,
      lastStatus: nonOkState.lastStatus,
      statusCounts: nonOkState.statusCounts,
      attempts: nonOkState.attempts,
      retryAfterMs: nonOkState.lastRetryAfterMs,
      bodyPreview: nonOkState.lastBodyPreview,
    });
    throw buildPollRateLimitError(conversationId, nonOkState);
  }
  return { fileIds: [] as string[], parentMessageId: "" };
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
