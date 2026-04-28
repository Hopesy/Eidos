import { randomUUID } from "node:crypto";

import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import { captureBuildInfoFromHtml, getPowConfig, getProofToken, getRequirementsToken } from "@/server/providers/openai-proof";
import type { AccountRecord } from "@/server/types";

const BASE_URL = "https://chatgpt.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "gpt-4o";

export type ImageFailureKind =
  | "submit_failed"
  | "accepted_pending"
  | "source_invalid"
  | "result_fetch_failed"
  | "account_blocked"
  | "input_blocked"
  | "unknown";

export type ImageRetryAction = "resubmit" | "resume_polling" | "retry_download" | "switch_account" | "revise_input" | "none";

export type ImagePipelineStage =
  | "validation"
  | "account"
  | "upload"
  | "submit"
  | "poll"
  | "download"
  | "api_service"
  | "unknown";

type ImageGenerationErrorOptions = {
  kind?: ImageFailureKind;
  retryAction?: ImageRetryAction;
  retryable?: boolean;
  stage?: ImagePipelineStage;
  statusCode?: number;
  upstreamConversationId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
};

export class ImageGenerationError extends Error {
  kind: ImageFailureKind;
  retryAction: ImageRetryAction;
  retryable: boolean;
  stage: ImagePipelineStage;
  statusCode?: number;
  upstreamConversationId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];

  constructor(message: string, options: ImageGenerationErrorOptions = {}) {
    super(message);
    this.name = "ImageGenerationError";
    this.kind = options.kind ?? "unknown";
    this.retryAction = options.retryAction ?? "none";
    this.retryable = options.retryable ?? false;
    this.stage = options.stage ?? "unknown";
    this.statusCode = options.statusCode;
    this.upstreamConversationId = options.upstreamConversationId;
    this.upstreamResponseId = options.upstreamResponseId;
    this.imageGenerationCallId = options.imageGenerationCallId;
    this.sourceAccountId = options.sourceAccountId;
    this.fileIds = options.fileIds;
  }
}

function createImageError(message: string, options: ImageGenerationErrorOptions = {}) {
  return new ImageGenerationError(message, options);
}

function parseUpstreamErrorPayload(raw: string) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const nestedError =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : payload;
    const message = cleanToken(nestedError.message || payload.message || payload.error);
    const code = cleanToken(nestedError.code || payload.code);
    const type = cleanToken(nestedError.type || payload.type);
    if (!message && !code && !type) {
      return null;
    }
    return {
      message,
      code,
      type,
    };
  } catch {
    return null;
  }
}

function normalizeUpstreamErrorMessage(raw: string) {
  const parsed = parseUpstreamErrorPayload(raw);
  if (!parsed) {
    return String(raw || "").trim();
  }

  if (parsed.code === "content_policy_violation" && parsed.message) {
    return `内容审核拦截：${parsed.message}`;
  }

  return parsed.message || parsed.code || parsed.type || String(raw || "").trim();
}

function isInputBlockedMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("content policy") ||
    normalized.includes("content_policy_violation") ||
    normalized.includes("safety") ||
    normalized.includes("policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("bad request") ||
    normalized.includes("cannot generate") ||
    normalized.includes("unable to generate") ||
    normalized.includes("抱歉，我不能") ||
    normalized.includes("抱歉，我无法") ||
    normalized.includes("无法生成") ||
    normalized.includes("不能生成") ||
    normalized.includes("性暗示") ||
    normalized.includes("色情")
  );
}

function isAccountBlockedMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("token_invalidated") ||
    normalized.includes("token_revoked") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("invalidated oauth token") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("429") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized")
  );
}

function buildHttpImageError(message: string, status: number, stage: ImagePipelineStage, fallbackKind: ImageFailureKind = "submit_failed") {
  const normalizedMessage = normalizeUpstreamErrorMessage(message);
  const isApiServiceStage = stage === "api_service";
  if (status === 401 || status === 429) {
    if (isApiServiceStage && status === 401) {
      return createImageError(`图像 API 认证失败：${normalizedMessage}`, {
        kind: "account_blocked",
        retryAction: "none",
        retryable: false,
        stage,
        statusCode: status,
      });
    }
    if (isApiServiceStage && status === 429) {
      return createImageError(`图像 API 限流：${normalizedMessage}`, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage,
        statusCode: status,
      });
    }
    return createImageError(normalizedMessage, {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  if (status === 400 || status === 403 || isInputBlockedMessage(normalizedMessage)) {
    return createImageError(normalizedMessage, {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage,
      statusCode: status,
    });
  }
  if (status >= 500) {
    return createImageError(normalizedMessage, {
      kind: fallbackKind,
      retryAction: "resubmit",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  return createImageError(normalizedMessage, {
    kind: fallbackKind,
    retryAction: "resubmit",
    retryable: fallbackKind === "submit_failed",
    stage,
    statusCode: status,
  });
}

export function getImageErrorMeta(error: unknown) {
  if (!(error instanceof ImageGenerationError)) {
    return {};
  }
  return {
    failureKind: error.kind,
    retryAction: error.retryAction,
    retryable: error.retryable,
    stage: error.stage,
    upstreamConversationId: error.upstreamConversationId,
    upstreamResponseId: error.upstreamResponseId,
    imageGenerationCallId: error.imageGenerationCallId,
    sourceAccountId: error.sourceAccountId,
    fileIds: error.fileIds,
  };
}

type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type ImageApiServiceConfig = {
  apiKey: string;
  baseUrl?: string;
  apiStyle?: "v1" | "responses";
  responsesModel?: string;
};

type ImageGenerationOptions = {
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
};

type ResponsesContinuationOptions = {
  previousResponseId?: string;
  imageGenerationCallId?: string;
};

type UploadedMultimodalFile = {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  assetPointer: string;
};

type ParsedResponsesImageItem = {
  b64_json: string;
  revised_prompt: string | undefined;
  gen_id: string | undefined;
  response_id: string | undefined;
  image_generation_call_id: string | undefined;
};

type ConversationInput = {
  prompt: string;
  attachments?: UploadedMultimodalFile[];
};

function buildImagePromptWithOptions(prompt: string, options?: ImageGenerationOptions) {
  const normalizedPrompt = String(prompt || "").trim();
  const size = options?.size ?? "auto";
  const quality = options?.quality ?? "auto";
  const instructions: string[] = [];

  if (size === "1024x1024") {
    instructions.push("输出比例使用 1:1 方图构图。");
  } else if (size === "1536x1024") {
    instructions.push("输出比例使用 3:2 横图构图。");
  } else if (size === "1024x1536") {
    instructions.push("输出比例使用 2:3 竖图构图。");
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

function getImageDimensions(bytes: Buffer, mimeType: string) {
  try {
    if (mimeType === "image/png" && bytes.length >= 24) {
      return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
    }

    if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && bytes.length > 4) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            height: bytes.readUInt16BE(offset + 5),
            width: bytes.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }

    if (mimeType === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF") {
      const chunkType = bytes.toString("ascii", 12, 16);
      if (chunkType === "VP8X") {
        return {
          width: 1 + bytes.readUIntLE(24, 3),
          height: 1 + bytes.readUIntLE(27, 3),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
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

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

function resolveApiBase(baseUrl?: string) {
  const normalized = cleanToken(baseUrl) || "https://api.openai.com/v1";
  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function resolveImageApiEndpoint(baseUrl?: string, operation: "generations" | "edits" = "generations") {
  const base = resolveApiBase(baseUrl);
  const suffix = `/images/${operation}`;
  if (base.endsWith(suffix)) {
    return base;
  }
  return `${base}${suffix}`;
}

function resolveResponsesEndpoint(baseUrl?: string) {
  return `${resolveApiBase(baseUrl)}/responses`;
}

function resolveFilesEndpoint(baseUrl?: string) {
  return `${resolveApiBase(baseUrl)}/files`;
}

function parseResponsesImageOutputs(payload: Record<string, unknown>): ParsedResponsesImageItem[] {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const responseId = cleanToken(payload.id);
  return output
    .filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).type || "") === "image_generation_call")
    .map((item) => {
      const entry = item as Record<string, unknown>;
      const callId = cleanToken(entry.id);
      return {
        b64_json: typeof entry.result === "string" ? entry.result : "",
        revised_prompt: typeof entry.revised_prompt === "string" ? entry.revised_prompt : undefined,
        gen_id: responseId || undefined,
        response_id: responseId || undefined,
        image_generation_call_id: callId || undefined,
      } satisfies ParsedResponsesImageItem;
    })
    .filter((item) => Boolean(item.b64_json));
}

async function uploadInputFile(
  serviceConfig: ImageApiServiceConfig,
  file: File,
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  if (!apiKey) {
    throw createImageError("image api key is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }
  const endpoint = resolveFilesEndpoint(serviceConfig.baseUrl);
  const formData = new FormData();
  formData.append("purpose", "user_data");
  formData.append("file", file, file.name || "image.png");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 400);
    const normalizedMessage = normalizeUpstreamErrorMessage(bodyText || `file upload failed: ${response.status}`);
    if (response.status === 401) {
      throw createImageError(`图像 API 上传认证失败：${normalizedMessage}`, {
        kind: "account_blocked",
        retryAction: "none",
        retryable: false,
        stage: "api_service",
        statusCode: response.status,
      });
    }
    if (response.status === 429) {
      throw createImageError(`图像 API 上传限流：${normalizedMessage}`, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
        statusCode: response.status,
      });
    }
    throw buildHttpImageError(normalizedMessage, response.status, "api_service");
  }

  const payload = (await response.json()) as { id?: string };
  const fileId = cleanToken(payload.id);
  if (!fileId) {
    throw createImageError("uploaded file id is missing", {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "upload",
    });
  }
  return fileId;
}

async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = cleanToken(file.type) || "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function registerChatGptFileUpload(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  fileName: string,
  fileSize: number,
) {
  const candidates = [
    `${BASE_URL}/backend-api/files`,
    `${BASE_URL}/backend-anon/files`,
  ];
  let lastError = "";

  for (const endpoint of candidates) {
    const response = await session.fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "oai-device-id": deviceId,
        "oai-language": "zh-CN",
      },
      body: JSON.stringify({
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
        reset_rate_limits: false,
      }),
      timeoutMs: 30000,
    });

    if (!response.ok) {
      lastError = (await response.text()).slice(0, 300);
      continue;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const fileId = cleanToken(payload.file_id || (payload.file as Record<string, unknown> | undefined)?.id);
    const uploadUrl = cleanToken(payload.upload_url || payload.put_url);
    if (fileId && uploadUrl) {
      return { endpoint, fileId, uploadUrl };
    }
    lastError = JSON.stringify(payload).slice(0, 300);
  }

  throw createImageError(lastError || "chatgpt file register failed", {
    kind: isAccountBlockedMessage(lastError) ? "account_blocked" : "submit_failed",
    retryAction: isAccountBlockedMessage(lastError) ? "switch_account" : "resubmit",
    retryable: true,
    stage: "upload",
  });
}

async function uploadChatGptFileBytes(uploadUrl: string, bytes: Buffer, mimeType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": mimeType || "application/octet-stream",
      "x-ms-blob-type": "BlockBlob",
    },
    body: new Uint8Array(bytes),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 300);
    throw buildHttpImageError(bodyText || `chatgpt file upload failed: ${response.status}`, response.status, "upload");
  }
}

async function finalizeChatGptFileUpload(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  fileId: string,
  fileName: string,
  fileSize: number,
) {
  const candidates = [
    {
      endpoint: `${BASE_URL}/backend-api/files/${fileId}/uploaded`,
      body: {
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
    {
      endpoint: `${BASE_URL}/backend-api/files/process_upload_stream`,
      body: {
        file_id: fileId,
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
    {
      endpoint: `${BASE_URL}/backend-anon/files/process_upload_stream`,
      body: {
        file_id: fileId,
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
  ];
  let lastError = "";

  for (const candidate of candidates) {
    const response = await session.fetch(candidate.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "oai-device-id": deviceId,
        "oai-language": "zh-CN",
      },
      body: JSON.stringify(candidate.body),
      timeoutMs: 30000,
    });

    if (response.ok) {
      return;
    }

    lastError = (await response.text()).slice(0, 300);
  }

  throw createImageError(lastError || "chatgpt file finalize failed", {
    kind: isAccountBlockedMessage(lastError) ? "account_blocked" : "submit_failed",
    retryAction: isAccountBlockedMessage(lastError) ? "switch_account" : "resubmit",
    retryable: true,
    stage: "upload",
  });
}

async function uploadChatGptConversationFile(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  file: File,
) {
  const fileName = file.name || "image.png";
  const mimeType = cleanToken(file.type) || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const { fileId, uploadUrl } = await registerChatGptFileUpload(session, accessToken, deviceId, fileName, bytes.length);
  await uploadChatGptFileBytes(uploadUrl, bytes, mimeType);
  await finalizeChatGptFileUpload(session, accessToken, deviceId, fileId, fileName, bytes.length);
  const dimensions = getImageDimensions(bytes, mimeType);

  return {
    fileId,
    fileName,
    mimeType,
    sizeBytes: bytes.length,
    width: dimensions?.width,
    height: dimensions?.height,
    assetPointer: `file-service://${fileId}`,
  } satisfies UploadedMultimodalFile;
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

export async function generateImageResultWithApiService(
  serviceConfig: ImageApiServiceConfig,
  prompt: string,
  requestedModel: string,
  count: number,
  options: ImageGenerationOptions = {},
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const normalizedPrompt = cleanToken(prompt);
  const size = options.size ?? "auto";
  const quality = options.quality ?? "auto";
  if (!apiKey) {
    throw createImageError("image api key is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }
  if (!normalizedPrompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }

  const endpoint = resolveImageApiEndpoint(serviceConfig.baseUrl, "generations");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    logger.info("openai-client", "api-service:start", {
      endpoint,
      model: requestedModel,
      count,
      size,
      quality,
      promptLength: normalizedPrompt.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: normalizedPrompt,
        model: requestedModel,
        n: count,
        response_format: "b64_json",
        ...(size !== "auto" ? { size } : {}),
        ...(quality !== "auto" ? { quality } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const bodyText = (await response.text()).slice(0, 400);
      logger.error("openai-client", "api-service:failed", {
        endpoint,
        status: response.status,
        bodyPreview: bodyText,
      });
      throw buildHttpImageError(bodyText || `image api failed: ${response.status}`, response.status, "api_service");
    }

    const payload = (await response.json()) as {
      created?: number;
      data?: Array<Record<string, unknown>>;
    };

    const items = Array.isArray(payload.data) ? payload.data : [];
    if (items.length === 0) {
      throw createImageError("no image returned from api service", {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
      });
    }

    logger.info("openai-client", "api-service:done", {
      endpoint,
      requestedCount: count,
      returnedCount: items.length,
    });

    return {
      created: Number(payload.created || Math.floor(Date.now() / 1000)),
      data: items,
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    const isAbort = error instanceof Error && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? "image api request timed out" : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function editImageResultWithApiService(
  serviceConfig: ImageApiServiceConfig,
  params: {
    prompt: string;
    model: string;
    images: File[];
    mask?: File | null;
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
  },
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const prompt = cleanToken(params.prompt);
  const model = cleanToken(params.model) || "gpt-image-1";
  const size = params.size ?? "auto";
  const quality = params.quality ?? "auto";
  const images = params.images.filter(Boolean);
  if (!apiKey) {
    throw createImageError("image api key is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }
  if (!prompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }
  if (images.length === 0) {
    throw createImageError("edit image is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }

  const endpoint = resolveImageApiEndpoint(serviceConfig.baseUrl, "edits");
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("model", model);
  formData.append("response_format", "b64_json");
  if (size !== "auto") {
    formData.append("size", size);
  }
  if (quality !== "auto") {
    formData.append("quality", quality);
  }
  images.forEach((image) => formData.append("image", image));
  if (params.mask) {
    formData.append("mask", params.mask);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    logger.info("openai-client", "api-service:edit:start", {
      endpoint,
      model,
      imageCount: images.length,
      hasMask: Boolean(params.mask),
      size,
      quality,
      prompt,
      promptLength: prompt.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const bodyText = (await response.text()).slice(0, 400);
      logger.error("openai-client", "api-service:edit:failed", {
        endpoint,
        status: response.status,
        bodyPreview: bodyText,
      });
      throw buildHttpImageError(bodyText || `image edit api failed: ${response.status}`, response.status, "api_service");
    }

    const payload = (await response.json()) as {
      created?: number;
      data?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(payload.data) ? payload.data : [];
    if (items.length === 0) {
      throw createImageError("no image returned from edit api service", {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
      });
    }

    logger.info("openai-client", "api-service:edit:done", {
      endpoint,
      returnedCount: items.length,
    });

    return {
      created: Number(payload.created || Math.floor(Date.now() / 1000)),
      data: items,
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    const isAbort = error instanceof Error && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? "image edit api request timed out" : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageResultWithResponsesApiService(
  serviceConfig: ImageApiServiceConfig,
  prompt: string,
  _requestedModel: string,
  count: number,
  options: ImageGenerationOptions = {},
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const normalizedPrompt = cleanToken(prompt);
  const model = cleanToken(serviceConfig.responsesModel) || "gpt-5.5";
  const size = options.size ?? "auto";
  const quality = options.quality ?? "auto";
  if (!apiKey) {
    throw createImageError("image api key is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }
  if (!normalizedPrompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }

  const endpoint = resolveResponsesEndpoint(serviceConfig.baseUrl);
  const requests = Array.from({ length: count }).map(async (_, index) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      logger.info("openai-client", "responses-service:generate:start", {
        endpoint,
        model,
        requestIndex: index + 1,
        total: count,
        size,
        quality,
        promptLength: normalizedPrompt.length,
      });

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
          body: JSON.stringify({
            model,
            input: normalizedPrompt,
            tools: [
              {
                type: "image_generation",
                action: "generate",
                ...(quality !== "auto" ? { quality } : {}),
                ...(size !== "auto" ? { size } : {}),
              },
            ],
            tool_choice: "required",
          }),
          signal: controller.signal,
          cache: "no-store",
        });

      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 400);
        throw buildHttpImageError(bodyText || `responses api failed: ${response.status}`, response.status, "api_service");
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const items = parseResponsesImageOutputs(payload);
      if (items.length === 0) {
        throw createImageError("no image returned from responses api service", {
          kind: "submit_failed",
          retryAction: "resubmit",
          retryable: true,
          stage: "api_service",
        });
      }
      return items;
    } catch (error) {
      if (error instanceof ImageGenerationError) {
        throw error;
      }
      const isAbort = error instanceof Error && error.name === "AbortError";
      const message = error instanceof Error ? error.message : String(error);
      throw createImageError(isAbort ? "responses image request timed out" : message, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  const settled = await Promise.allSettled(requests);
  const fulfilled = settled
    .filter((entry): entry is PromiseFulfilledResult<ParsedResponsesImageItem[]> => entry.status === "fulfilled")
    .flatMap((entry) => entry.value);
  if (fulfilled.length === 0) {
    const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    if (rejected) {
      throw rejected.reason;
    }
    throw createImageError("responses api returned no successful image requests", {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: fulfilled,
  };
}

export async function editImageResultWithResponsesApiService(
  serviceConfig: ImageApiServiceConfig,
  params: {
    prompt: string;
    images: File[];
    mask?: File | null;
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
    continuation?: ResponsesContinuationOptions | null;
  },
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const prompt = cleanToken(params.prompt);
  const model = cleanToken(serviceConfig.responsesModel) || "gpt-5.5";
  const previousResponseId = cleanToken(params.continuation?.previousResponseId);
  const imageGenerationCallId = cleanToken(params.continuation?.imageGenerationCallId);
  const size = params.size ?? "auto";
  const quality = params.quality ?? "auto";
  const images = params.images.filter(Boolean);
  if (!apiKey) {
    throw createImageError("image api key is required", {
      kind: "input_blocked",
      retryAction: "none",
      retryable: false,
      stage: "validation",
    });
  }
  if (!prompt) {
    throw createImageError("prompt is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }
  if (images.length === 0) {
    throw createImageError("edit image is required", {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "validation",
    });
  }

  const endpoint = resolveResponsesEndpoint(serviceConfig.baseUrl);
  const useDataUrlInputs = !params.mask;
  const uploadedImageIds = useDataUrlInputs ? [] : await Promise.all(images.map((image) => uploadInputFile(serviceConfig, image)));
  const maskFileId = params.mask ? await uploadInputFile(serviceConfig, params.mask) : null;
  const inputContent = [
    {
      type: "input_text",
      text: prompt,
    },
    ...(useDataUrlInputs
      ? await Promise.all(
        images.map(async (image) => ({
          type: "input_image" as const,
          image_url: await fileToDataUrl(image),
        })),
      )
      : uploadedImageIds.map((fileId) => ({
        type: "input_image",
        file_id: fileId,
      }))),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    logger.info("openai-client", "responses-service:edit:start", {
      endpoint,
      model,
      imageCount: images.length,
      hasMask: Boolean(maskFileId),
      inputMode: useDataUrlInputs ? "image_url" : "file_id",
      hasPreviousResponseId: Boolean(previousResponseId),
      hasImageGenerationCallId: Boolean(imageGenerationCallId),
      size,
      quality,
      prompt,
      promptLength: prompt.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        input: [
          {
            role: "user",
            content: inputContent,
          },
          ...(imageGenerationCallId
            ? [
              {
                type: "image_generation_call",
                id: imageGenerationCallId,
              },
            ]
            : []),
        ],
        tools: [
          {
            type: "image_generation",
            action: "edit",
            ...(quality !== "auto" ? { quality } : {}),
            ...(size !== "auto" ? { size } : {}),
            ...(maskFileId ? { input_image_mask: { file_id: maskFileId } } : {}),
          },
        ],
        tool_choice: "required",
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const bodyText = (await response.text()).slice(0, 400);
      throw buildHttpImageError(bodyText || `responses edit api failed: ${response.status}`, response.status, "api_service");
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const items = parseResponsesImageOutputs(payload);
    if (items.length === 0) {
      throw createImageError("no image returned from responses edit api service", {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
      });
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data: items,
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    const isAbort = error instanceof Error && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? "responses edit request timed out" : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    clearTimeout(timeout);
  }
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

async function pollImageIds(session: CookieSession, accessToken: string, deviceId: string, conversationId: string) {
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

async function fetchDownloadUrl(
  session: CookieSession,
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

async function downloadAsBase64(session: CookieSession, downloadUrl: string) {
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

async function collectGeneratedItems(
  session: CookieSession,
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

async function recoverGeneratedItems(
  session: CookieSession,
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
