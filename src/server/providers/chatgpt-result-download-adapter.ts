import { logger } from "@/server/logger";
import {
  createImageError,
} from "@/server/providers/openai-image-errors";

import {
  BASE_URL,
  maskAccessToken,
  type ChatGptResultSession,
} from "./chatgpt-result-shared";
import { extractImageIds } from "./chatgpt-result-parser";

export async function pollImageIds(session: ChatGptResultSession, accessToken: string, deviceId: string, conversationId: string) {
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

export async function fetchDownloadUrl(
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

export async function downloadAsBase64(session: ChatGptResultSession, downloadUrl: string) {
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
