import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
  normalizeUpstreamErrorMessage,
} from "@/server/providers/openai-image-errors";

function cleanToken(value: unknown) {
  return String(value || "").trim();
}
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

type ParsedResponsesImageItem = {
  b64_json: string;
  revised_prompt: string | undefined;
  gen_id: string | undefined;
  response_id: string | undefined;
  image_generation_call_id: string | undefined;
};

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


