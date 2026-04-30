import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
} from "@/server/providers/openai/image-errors";

import {
  cleanToken,
  fileToDataUrl,
  resolveResponsesEndpoint,
  uploadInputFile,
  type ImageApiServiceConfig,
  type ImageGenerationOptions,
  type ResponsesContinuationOptions,
} from "./api-service-shared";

type ParsedResponsesImageItem = {
  b64_json: string;
  revised_prompt: string | undefined;
  gen_id: string | undefined;
  response_id: string | undefined;
  image_generation_call_id: string | undefined;
};

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
