import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import { createAbortError, createLinkedAbortController, isAbortError, throwIfAborted } from "@/server/image/abort";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
  parseRetryAfterHeader,
} from "@/server/providers/openai/image-errors";

import {
  cleanToken,
  resolveImageApiEndpoint,
  type ImageApiServiceConfig,
  type ImageGenerationOptions,
} from "./api-service-shared";

const GPT_IMAGE_MODELS = new Set(["gpt-image-1", "gpt-image-2"]);

function supportsResponseFormat(model: string) {
  return !GPT_IMAGE_MODELS.has(cleanToken(model).toLowerCase());
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
  const outputFormat = options.format ?? "png";
  throwIfAborted(options.signal);
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
  const controller = createLinkedAbortController(options.signal, 120000);
  try {
    logger.info("openai-client", "api-service:start", {
      endpoint,
      model: requestedModel,
      count,
      size,
      quality,
      outputFormat,
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
        ...(supportsResponseFormat(requestedModel) ? { response_format: "b64_json" } : {}),
        output_format: outputFormat,
        ...(size !== "auto" ? { size } : {}),
        ...(quality !== "auto" ? { quality } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const bodyText = (await response.text()).slice(0, 200);
      logger.error("openai-client", "api-service:failed", {
        endpoint,
        status: response.status,
        bodyPreview: bodyText,
      });
      throw buildHttpImageError(
        bodyText || `image api failed: ${response.status}`,
        response.status,
        "api_service",
        "submit_failed",
        { retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")) },
      );
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
    if (controller.parentAborted() || (isAbortError(error) && !controller.timedOut())) {
      throw createAbortError();
    }
    const isAbort = isAbortError(error);
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? "image api request timed out" : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    controller.cleanup();
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
    format?: ImageOutputFormat;
    signal?: AbortSignal;
  },
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const prompt = cleanToken(params.prompt);
  const model = cleanToken(params.model) || "gpt-image-1";
  const size = params.size ?? "auto";
  const quality = params.quality ?? "auto";
  const outputFormat = params.format ?? "png";
  const images = params.images.filter(Boolean);
  throwIfAborted(params.signal);
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
  if (supportsResponseFormat(model)) {
    formData.append("response_format", "b64_json");
  }
  formData.append("output_format", outputFormat);
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

  const controller = createLinkedAbortController(params.signal, 120000);
  try {
    logger.info("openai-client", "api-service:edit:start", {
      endpoint,
      model,
      imageCount: images.length,
      hasMask: Boolean(params.mask),
      size,
      quality,
      outputFormat,
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
      const bodyText = (await response.text()).slice(0, 200);
      logger.error("openai-client", "api-service:edit:failed", {
        endpoint,
        status: response.status,
        bodyPreview: bodyText,
      });
      throw buildHttpImageError(
        bodyText || `image edit api failed: ${response.status}`,
        response.status,
        "api_service",
        "submit_failed",
        { retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")) },
      );
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
    if (controller.parentAborted() || (isAbortError(error) && !controller.timedOut())) {
      throw createAbortError();
    }
    const isAbort = isAbortError(error);
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? "image edit api request timed out" : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    controller.cleanup();
  }
}
