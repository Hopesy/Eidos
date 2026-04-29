import { randomUUID } from "node:crypto";

import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
} from "@/server/providers/openai-image-errors";
import {
  editImageResultWithApiService,
  editImageResultWithResponsesApiService,
  generateImageResultWithApiService,
  generateImageResultWithResponsesApiService,
  type ImageGenerationOptions,
} from "@/server/providers/openai-api-service-adapter";
export {
  editImageResultWithApiService,
  editImageResultWithResponsesApiService,
  generateImageResultWithApiService,
  generateImageResultWithResponsesApiService,
} from "@/server/providers/openai-api-service-adapter";
export type {
  ImageApiServiceConfig,
} from "@/server/providers/openai-api-service-adapter";
import {
  uploadChatGptConversationFile,
  type UploadedMultimodalFile,
} from "@/server/providers/chatgpt-file-upload-adapter";
import {
  collectGeneratedItems,
  recoverGeneratedItems,
} from "@/server/providers/chatgpt-result-adapter";
import { captureBuildInfoFromHtml, getPowConfig, getProofToken, getRequirementsToken } from "@/server/providers/openai-proof";
import type { AccountRecord } from "@/server/types";

export {
  ImageGenerationError,
  getImageErrorMeta,
} from "@/server/providers/openai-image-errors";
export type {
  ImageFailureKind,
  ImagePipelineStage,
  ImageRetryAction,
} from "@/server/providers/openai-image-errors";

const BASE_URL = "https://chatgpt.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "gpt-4o";

type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

type ConversationInput = {
  prompt: string;
  attachments?: UploadedMultimodalFile[];
};

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

class CookieSession {
  private readonly cookies = new Map<string, string>();
  private readonly defaultHeaders: HeadersInit;

  constructor(defaultHeaders: HeadersInit = {}) {
    this.defaultHeaders = defaultHeaders;
  }

  private applyResponseCookies(response: Response) {
    const headerBag = response.headers as Headers & { getSetCookie?: () => string[] };
    const rawCookies = headerBag.getSetCookie?.() ?? [];
    for (const item of rawCookies) {
      const [cookiePart] = item.split(";", 1);
      const [name, ...rest] = cookiePart.split("=");
      if (!name || rest.length === 0) {
        continue;
      }
      this.cookies.set(name.trim(), rest.join("=").trim());
    }
  }

  private buildCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  async fetch(url: string, options: FetchOptions = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
    const headers = new Headers(this.defaultHeaders);
    const nextHeaders = new Headers(options.headers ?? {});
    for (const [key, value] of nextHeaders.entries()) {
      headers.set(key, value);
    }
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      this.applyResponseCookies(response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const label = isAbort ? "request timed out" : `network error: ${message}`;
      throw createImageError(label, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "submit",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

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



function maskAccessToken(accessToken: string) {
  const normalized = cleanToken(accessToken);
  if (!normalized) {
    return "";
  }
  return normalized.length <= 16 ? normalized : `${normalized.slice(0, 16)}...`;
}

function resolveFingerprint(account?: AccountRecord | null) {
  const fp = ((account?.fp as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  return {
    userAgent: cleanToken(fp["user-agent"] || account?.["user-agent"]) || USER_AGENT,
    deviceId: cleanToken(fp["oai-device-id"] || account?.["oai-device-id"]) || randomUUID(),
    secChUa:
      cleanToken(fp["sec-ch-ua"] || account?.["sec-ch-ua"]) ||
      '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    secChUaMobile: cleanToken(fp["sec-ch-ua-mobile"] || account?.["sec-ch-ua-mobile"]) || "?0",
    secChUaPlatform: cleanToken(fp["sec-ch-ua-platform"] || account?.["sec-ch-ua-platform"]) || '"Windows"',
    sessionId: cleanToken(fp["oai-session-id"] || account?.["oai-session-id"]),
  };
}

export function isTokenInvalidError(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("token_invalidated") ||
    normalized.includes("token_revoked") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("invalidated oauth token")
  );
}

export function resolveUpstreamModel(account: AccountRecord | null, requestedModel: string) {
  const normalized = cleanToken(requestedModel) || "gpt-image-1";
  const isFreeAccount = cleanToken(account?.type || "Free") === "Free";
  if (normalized === "gpt-image-1") {
    return "auto";
  }
  if (normalized === "gpt-image-2") {
    return isFreeAccount ? "auto" : "gpt-5-3";
  }
  return normalized || DEFAULT_MODEL;
}









async function bootstrap(session: CookieSession, fingerprint: ReturnType<typeof resolveFingerprint>) {
  logger.info("openai-client", "bootstrap:start", {
    deviceId: fingerprint.deviceId,
    hasSessionId: Boolean(fingerprint.sessionId),
  });
  const response = await session.fetch(`${BASE_URL}/`, { timeoutMs: 30000 });
  const html = await response.text();
  if (!response.ok) {
    logger.warn("openai-client", "bootstrap:non-ok", {
      status: response.status,
      bodyPreview: html.slice(0, 240),
    });
  }
  captureBuildInfoFromHtml(html);
  logger.info("openai-client", "bootstrap:done", {
    deviceId: fingerprint.deviceId,
    status: response.status,
  });
  return fingerprint.deviceId;
}

async function getChatRequirements(session: CookieSession, accessToken: string, deviceId: string, userAgent: string) {
  const config = getPowConfig(userAgent);
  logger.info("openai-client", "chat-requirements:start", {
    deviceId,
    token: maskAccessToken(accessToken),
  });
  const response = await session.fetch(`${BASE_URL}/backend-api/sentinel/chat-requirements`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "oai-device-id": deviceId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p: getRequirementsToken(config) }),
    timeoutMs: 30000,
  });

  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 400);
    logger.error("openai-client", "chat-requirements:failed", {
      deviceId,
      token: maskAccessToken(accessToken),
      status: response.status,
      bodyPreview: bodyText,
    });
    throw buildHttpImageError(bodyText || `chat-requirements failed: ${response.status}`, response.status, "submit");
  }

  const payload = (await response.json()) as {
    token: string;
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  };

  logger.info("openai-client", "chat-requirements:done", {
    deviceId,
    token: maskAccessToken(accessToken),
    proofRequired: Boolean(payload.proofofwork?.required),
  });

  return {
    chatToken: payload.token,
    pow: payload.proofofwork || {},
    powConfig: config,
  };
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
  const response = await session.fetch(`${BASE_URL}/backend-api/conversation`, {
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
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
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



export async function fetchRemoteAccountInfo(accessToken: string, account: AccountRecord | null) {
  const fingerprint = resolveFingerprint(account);
  const session = new CookieSession({
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "oai-language": "zh-CN",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": fingerprint.userAgent,
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = fingerprint.deviceId;
  const meHeaders = {
    authorization: `Bearer ${accessToken}`,
    "oai-device-id": deviceId,
    "x-openai-target-path": "/backend-api/me",
    "x-openai-target-route": "/backend-api/me",
  };

  const initHeaders = {
    authorization: `Bearer ${accessToken}`,
    "oai-device-id": deviceId,
  };

  const [meResponse, initResponse] = await Promise.all([
    session.fetch(`${BASE_URL}/backend-api/me`, {
      headers: meHeaders,
      timeoutMs: 20000,
    }),
    session.fetch(`${BASE_URL}/backend-api/conversation/init`, {
      method: "POST",
      headers: initHeaders,
      body: JSON.stringify({
        gizmo_id: null,
        requested_default_model: null,
        conversation_id: null,
        timezone_offset_min: -480,
      }),
      timeoutMs: 20000,
    }),
  ]);

  if (!meResponse.ok) {
    throw new Error(`/backend-api/me failed: HTTP ${meResponse.status}`);
  }
  if (!initResponse.ok) {
    throw new Error(`/backend-api/conversation/init failed: HTTP ${initResponse.status}`);
  }

  return {
    mePayload: (await meResponse.json()) as Record<string, unknown>,
    initPayload: (await initResponse.json()) as Record<string, unknown>,
  };
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

  const fingerprint = resolveFingerprint(account);
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
  const session = new CookieSession({
    "user-agent": fingerprint.userAgent,
    "accept-language": "en-US,en;q=0.9",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    accept: "*/*",
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "oai-device-id": fingerprint.deviceId,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = await bootstrap(session, fingerprint);
  const { chatToken, pow, powConfig } = await getChatRequirements(session, normalizedToken, deviceId, fingerprint.userAgent);
  const proofToken =
    pow.required && pow.seed && pow.difficulty
      ? getProofToken(String(pow.seed), String(pow.difficulty), fingerprint.userAgent, powConfig)
      : null;
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

  const fingerprint = resolveFingerprint(account);
  const upstreamModel = resolveUpstreamModel(account, requestedModel);
  const session = new CookieSession({
    "user-agent": fingerprint.userAgent,
    "accept-language": "en-US,en;q=0.9",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    accept: "*/*",
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "oai-device-id": fingerprint.deviceId,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = await bootstrap(session, fingerprint);
  const { chatToken, pow, powConfig } = await getChatRequirements(session, normalizedToken, deviceId, fingerprint.userAgent);
  const proofToken =
    pow.required && pow.seed && pow.difficulty
      ? getProofToken(String(pow.seed), String(pow.difficulty), fingerprint.userAgent, powConfig)
      : null;

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
  const session = new CookieSession({
    "user-agent": fingerprint.userAgent,
    "accept-language": "en-US,en;q=0.9",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    accept: "*/*",
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "oai-device-id": fingerprint.deviceId,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = await bootstrap(session, fingerprint);
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




