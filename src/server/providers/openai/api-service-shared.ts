import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import {
  buildHttpImageError,
  createImageError,
  normalizeUpstreamErrorMessage,
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

export async function uploadInputFile(
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

export async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = cleanToken(file.type) || "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
