import { randomUUID } from "node:crypto";

import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import { uploadChatGptConversationFile, type UploadedMultimodalFile } from "@/server/providers/chatgpt-file-upload-adapter";
import { collectGeneratedItems, recoverGeneratedItems } from "@/server/providers/chatgpt-result-adapter";
import {
  bootstrapChatGptSession,
  CHATGPT_BASE_URL,
  cleanToken,
  CookieSession,
  createChatGptSession,
  getChatRequirements,
  maskAccessToken,
  resolveFingerprint,
  resolveUpstreamModel,
} from "@/server/providers/chatgpt-session-adapter";
import {
  buildHttpImageError,
  createImageError,
} from "@/server/providers/openai-image-errors";
import { getProofToken } from "@/server/providers/openai-proof";
import type { ImageGenerationOptions } from "@/server/providers/openai-api-service-adapter";
import type { AccountRecord } from "@/server/types";

type ConversationInput = {
  prompt: string;
  attachments?: UploadedMultimodalFile[];
};

function buildImagePromptWithOptions(prompt: string, options?: ImageGenerationOptions) {
  const normalizedPrompt = String(prompt || "").trim();
  const size = options?.size ?? "auto";
  const quality = options?.quality ?? "auto";
  const instructions: string[] = [];

  if (size !== "auto") {
    instructions.push(`输出分辨率使用 ${size}。`);
  }

  if (quality === "medium") {
    instructions.push("请以中高细节和清晰画质完成最终渲染。");
  } else if (quality === "high") {
    instructions.push("请以极高细节、超清画质完成最终渲染。");
  } else if (quality === "low") {
    instructions.push("请以低耗时预览画质快速出图。");
  }

  if (instructions.length === 0) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt}\n\n补充输出要求：\n- ${instructions.join("\n- ")}`;
}

function buildConversationMessage(input: ConversationInput) {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return {
      id: randomUUID(),
      author: { role: "user" },
      content: { content_type: "text", parts: [input.prompt] },
      metadata: { attachments: [] },
    };
  }

  return {
    id: randomUUID(),
    author: { role: "user" },
    content: {
      content_type: "multimodal_text",
      parts: [
        ...attachments.map((attachment) => ({
          content_type: "image_asset_pointer",
          asset_pointer: attachment.assetPointer,
          size_bytes: attachment.sizeBytes,
          width: attachment.width,
          height: attachment.height,
        })),
        input.prompt,
      ],
    },
    metadata: {
      attachments: attachments.map((attachment) => ({
        id: attachment.fileId,
        name: attachment.fileName,
        mime_type: attachment.mimeType,
        size: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
      })),
    },
  };
}

async function sendConversation(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  chatToken: string,
  proofToken: string | null,
  input: ConversationInput,
  model: string,
) {
  logger.info("openai-client", "conversation:start", {
    deviceId,
    token: maskAccessToken(accessToken),
    model,
    promptLength: input.prompt.length,
    attachmentCount: input.attachments?.length ?? 0,
    hasProofToken: Boolean(proofToken),
  });
  const response = await session.fetch(`${CHATGPT_BASE_URL}/backend-api/conversation`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "text/event-stream",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "content-type": "application/json",
      "oai-device-id": deviceId,
      "oai-language": "zh-CN",
      "oai-client-build-number": "5955942",
      "oai-client-version": "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad",
      origin: CHATGPT_BASE_URL,
      referer: `${CHATGPT_BASE_URL}/`,
      "openai-sentinel-chat-requirements-token": chatToken,
      ...(proofToken ? { "openai-sentinel-proof-token": proofToken } : {}),
    },
    body: JSON.stringify({
      action: "next",
      messages: [buildConversationMessage(input)],
      parent_message_id: randomUUID(),
      model,
      history_and_training_disabled: false,
      timezone_offset_min: -480,
      timezone: "America/Los_Angeles",
      conversation_mode: { kind: "primary_assistant" },
      websocket_request_id: randomUUID(),
      force_paragen: false,
      force_use_sse: true,
      system_hints: ["picture_v2"],
      supported_encodings: [],
      client_contextual_info: {
        is_dark_mode: false,
        time_since_loaded: 120,
        page_height: 900,
        page_width: 1600,
        pixel_ratio: 1.2,
        screen_height: 1080,
        screen_width: 1920,
      },
    }),
    timeoutMs: 180000,
  });

  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 400);
    logger.error("openai-client", "conversation:failed", {
      deviceId,
      token: maskAccessToken(accessToken),
      model,
      status: response.status,
      bodyPreview: bodyText,
    });
    throw buildHttpImageError(bodyText || `conversation failed: ${response.status}`, response.status, "submit");
  }

  logger.info("openai-client", "conversation:accepted", {
    deviceId,
    token: maskAccessToken(accessToken),
    model,
    status: response.status,
  });
  return response;
}

async function prepareConversationContext(accessToken: string, account: AccountRecord | null) {
  const fingerprint = resolveFingerprint(account);
  const session = createChatGptSession(fingerprint);
  const deviceId = await bootstrapChatGptSession(session, fingerprint);
  const { chatToken, pow, powConfig } = await getChatRequirements(session, accessToken, deviceId, fingerprint.userAgent);
  const proofToken =
    pow.required && pow.seed && pow.difficulty
      ? getProofToken(String(pow.seed), String(pow.difficulty), fingerprint.userAgent, powConfig)
      : null;
  return { fingerprint, session, deviceId, chatToken, proofToken };
}

export async function generateImageResult(
  accessToken: string,
  prompt: string,
  requestedModel: string,
  account: AccountRecord | null,
  options: ImageGenerationOptions = {},
) {
  const normalizedPrompt = cleanToken(prompt);
  const normalizedToken = cleanToken(accessToken);
  const size = options.size ?? "auto";
  const quality = options.quality ?? "auto";
  const effectivePrompt = buildImagePromptWithOptions(normalizedPrompt, options);
  if (!normalizedPrompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }
  if (!normalizedToken) {
    throw createImageError("token is required", {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: false,
      stage: "account",
    });
  }

  const upstreamModel = resolveUpstreamModel(account, requestedModel);
  logger.info("openai-client", "generate-image:start", {
    token: maskAccessToken(normalizedToken),
    requestedModel,
    upstreamModel,
    size,
    quality,
    promptLength: normalizedPrompt.length,
    accountType: account?.type ?? null,
    accountEmail: account?.email ?? null,
  });

  const { session, deviceId, chatToken, proofToken } = await prepareConversationContext(normalizedToken, account);
  const response = await sendConversation(
    session,
    normalizedToken,
    deviceId,
    chatToken,
    proofToken,
    { prompt: effectivePrompt },
    upstreamModel,
  );
  return collectGeneratedItems(session, normalizedToken, deviceId, await response.text(), normalizedPrompt);
}

export async function generateImageResultWithAttachments(
  accessToken: string,
  prompt: string,
  requestedModel: string,
  account: AccountRecord | null,
  params: {
    images: File[];
    mask?: File | null;
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
  },
) {
  const normalizedPrompt = cleanToken(prompt);
  const normalizedToken = cleanToken(accessToken);
  if (!normalizedPrompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }
  if (!normalizedToken) {
    throw createImageError("token is required", {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: false,
      stage: "account",
    });
  }

  const upstreamModel = resolveUpstreamModel(account, requestedModel);
  const { session, deviceId, chatToken, proofToken } = await prepareConversationContext(normalizedToken, account);

  const uploadedFiles = await Promise.all(
    [...params.images.filter(Boolean), ...(params.mask ? [params.mask] : [])].map((file) =>
      uploadChatGptConversationFile(session, normalizedToken, deviceId, file),
    ),
  );
  const promptWithOptions = buildImagePromptWithOptions(normalizedPrompt, params);
  const effectivePrompt = params.mask
    ? `${promptWithOptions}\n\n附加要求：第 1 张附件是源图，最后 1 张附件是遮罩图。请仅修改遮罩区域，未遮罩区域尽量保持与源图一致。`
    : `${promptWithOptions}\n\n附加要求：请参考已附加图片的构图、主体或风格完成生成。`;

  logger.info("openai-client", "generate-image:attachments:start", {
    token: maskAccessToken(normalizedToken),
    requestedModel,
    upstreamModel,
    imageCount: params.images.length,
    hasMask: Boolean(params.mask),
    promptLength: normalizedPrompt.length,
  });

  const response = await sendConversation(
    session,
    normalizedToken,
    deviceId,
    chatToken,
    proofToken,
    {
      prompt: effectivePrompt,
      attachments: uploadedFiles,
    },
    upstreamModel,
  );

  return collectGeneratedItems(session, normalizedToken, deviceId, await response.text(), normalizedPrompt);
}

export async function recoverImageResult(
  accessToken: string,
  requestedModel: string,
  account: AccountRecord | null,
  recovery: {
    conversationId: string;
    fileIds?: string[];
    revisedPrompt?: string;
    waitMs?: number;
  },
) {
  const normalizedToken = cleanToken(accessToken);
  if (!normalizedToken) {
    throw createImageError("token is required", {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: false,
      stage: "account",
    });
  }

  const fingerprint = resolveFingerprint(account);
  const session = createChatGptSession(fingerprint);
  const deviceId = await bootstrapChatGptSession(session, fingerprint);
  const result = await recoverGeneratedItems(session, normalizedToken, deviceId, recovery);
  result.data = result.data.map((item) => ({
    ...item,
    source_account_id: cleanToken(account?.id) || undefined,
  }));
  logger.info("openai-client", "recover-image:done", {
    requestedModel,
    conversationId: recovery.conversationId,
    count: result.data.length,
    sourceAccountId: cleanToken(account?.id) || null,
  });
  return result;
}
