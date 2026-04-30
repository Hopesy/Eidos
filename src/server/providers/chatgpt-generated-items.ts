import { logger } from "@/server/logger";
import {
  createImageError,
} from "@/server/providers/openai-image-errors";

import {
  downloadAsBase64,
  fetchDownloadUrl,
  pollImageIds,
} from "./chatgpt-result-download-adapter";
import {
  buildNoImageReturnedError,
  parseSsePayload,
} from "./chatgpt-result-parser";
import {
  cleanToken,
  maskAccessToken,
  type ChatGptResultSession,
} from "./chatgpt-result-shared";

type GeneratedDownloadItem = {
  b64_json: string;
  revised_prompt: string | undefined;
  file_id: string;
  conversation_id: string | undefined;
};

async function downloadGeneratedItems(
  session: ChatGptResultSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileIds: string[],
  revisedPrompt?: string,
) {
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

  return downloadResults
    .filter((r): r is PromiseFulfilledResult<GeneratedDownloadItem> => r.status === "fulfilled")
    .map((r) => r.value);
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

  const successItems = await downloadGeneratedItems(
    session,
    accessToken,
    deviceId,
    conversationId,
    fileIds,
    revisedPrompt,
  );

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

  const successItems = await downloadGeneratedItems(
    session,
    accessToken,
    deviceId,
    conversationId,
    fileIds,
    recovery.revisedPrompt,
  );

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
