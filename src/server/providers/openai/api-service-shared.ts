import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import { createLinkedAbortController, isAbortError, throwIfAborted } from "@/server/image/abort";
import {
  buildHttpImageError,
  createImageError,
  normalizeUpstreamErrorMessage,
  parseRetryAfterHeader,
} from "@/server/providers/openai/image-errors";

export type ImageApiServiceConfig = {
  apiKey: string;
  baseUrl?: string;
  apiStyle?: "v1" | "responses";
  responsesModel?: string;
};

export type ImageGenerationOptions = {
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  format?: ImageOutputFormat;
  continuation?: {
    conversationId?: string;
    parentMessageId?: string;
  } | null;
  signal?: AbortSignal;
};

export type ResponsesContinuationOptions = {
  previousResponseId?: string;
  imageGenerationCallId?: string;
};

export function cleanToken(value: unknown) {
  return String(value || "").trim();
}

export function resolveApiBase(baseUrl?: string) {
  const normalized = cleanToken(baseUrl) || "https://api.openai.com/v1";
  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function resolveImageApiEndpoint(baseUrl?: string, operation: "generations" | "edits" = "generations") {
  const base = resolveApiBase(baseUrl);
  const suffix = `/images/${operation}`;
  if (base.endsWith(suffix)) {
    return base;
  }
  return `${base}${suffix}`;
}

export function resolveResponsesEndpoint(baseUrl?: string) {
  return `${resolveApiBase(baseUrl)}/responses`;
}

export function resolveFilesEndpoint(baseUrl?: string) {
  return `${resolveApiBase(baseUrl)}/files`;
}

const UPLOAD_TIMEOUT_MS = 120000;

export async function uploadInputFile(
  serviceConfig: ImageApiServiceConfig,
  file: File,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
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

  const linked = createLinkedAbortController(signal, UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: linked.signal,
      cache: "no-store",
    });
  } catch (error) {
    linked.cleanup();
    if (linked.timedOut()) {
      throw createImageError(`图像 API 上传超时（${UPLOAD_TIMEOUT_MS / 1000}s）：${file.name || "image"}`, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "upload",
      });
    }
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "image api upload failed";
    throw createImageError(message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "upload",
    });
  }
  linked.cleanup();

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
      const retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
      throw createImageError(`图像 API 上传限流：${normalizedMessage}`, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
        statusCode: response.status,
        retryAfterMs,
      });
    }
    throw buildHttpImageError(normalizedMessage, response.status, "api_service", "submit_failed", {
      retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")),
    });
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

export async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = cleanToken(file.type) || "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
