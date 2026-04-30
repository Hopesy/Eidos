import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
} from "@/server/providers/openai/image-errors";

import {
  cleanToken,
  resolveImageApiEndpoint,
  type ImageApiServiceConfig,
  type ImageGenerationOptions,
} from "./api-service-shared";

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
