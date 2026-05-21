import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import { createAbortError, createLinkedAbortController, isAbortError, throwIfAborted } from "@/server/image/abort";
import { logger } from "@/server/logger";
import {
  ImageGenerationError,
  buildHttpImageError,
  createImageError,
  parseRetryAfterHeader,
} from "@/server/providers/openai/image-errors";
import { normalizeResponsesReasoningEffort } from "@/shared/app-config";

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

const SSE_STREAM_TIMEOUT_MS = 300_000;

type SSEImageCollector = {
  finalItems: ParsedResponsesImageItem[];
  partialB64: string;
  partialPrompt: string;
  responseId: string;
};

function parseSSEEvent(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function processSSEEvent(event: Record<string, unknown>, collector: SSEImageCollector) {
  const evType = String(event.type || "");

  if (!collector.responseId && typeof event.response === "object" && event.response) {
    const resp = event.response as Record<string, unknown>;
    if (typeof resp.id === "string") {
      collector.responseId = resp.id;
    }
  }

  if (evType === "response.image_generation_call.partial_image") {
    const b64 = event.partial_image_b64;
    if (typeof b64 === "string" && b64) {
      collector.partialB64 = b64;
    }
    const revised = event.revised_prompt;
    if (typeof revised === "string" && revised) {
      collector.partialPrompt = revised;
    }
    return;
  }

  if (evType === "response.output_item.done") {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") return;
    if (String(item.type || "") !== "image_generation_call") return;
    const result = typeof item.result === "string" ? item.result : "";
    const revised = typeof item.revised_prompt === "string" ? item.revised_prompt : undefined;
    const callId = typeof item.id === "string" ? item.id : undefined;
    if (result) {
      collector.finalItems.push({
        b64_json: result,
        revised_prompt: revised,
        gen_id: collector.responseId || undefined,
        response_id: collector.responseId || undefined,
        image_generation_call_id: callId,
      });
    }
    return;
  }

  if (evType === "response.completed") {
    const resp = event.response as Record<string, unknown> | undefined;
    if (resp && typeof resp === "object" && typeof resp.id === "string") {
      collector.responseId = resp.id;
    }
  }
}

async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<SSEImageCollector> {
  const collector: SSEImageCollector = {
    finalItems: [],
    partialB64: "",
    partialPrompt: "",
    responseId: "",
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, "");
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        const event = parseSSEEvent(payload);
        if (event) {
          processSSEEvent(event, collector);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim()) {
    const trimmed = buffer.replace(/\r$/, "");
    if (trimmed.startsWith("data: ")) {
      const payload = trimmed.slice(6).trim();
      if (payload && payload !== "[DONE]") {
        const event = parseSSEEvent(payload);
        if (event) {
          processSSEEvent(event, collector);
        }
      }
    }
  }

  return collector;
}

function resolveCollectorResults(collector: SSEImageCollector): ParsedResponsesImageItem[] {
  if (collector.finalItems.length > 0) {
    return collector.finalItems;
  }
  if (collector.partialB64) {
    return [{
      b64_json: collector.partialB64,
      revised_prompt: collector.partialPrompt || undefined,
      gen_id: collector.responseId || undefined,
      response_id: collector.responseId || undefined,
      image_generation_call_id: undefined,
    }];
  }
  return [];
}

function resolveReasoningPayload(
  serviceConfig: ImageApiServiceConfig,
  requestEffort: ImageGenerationOptions["responsesReasoningEffort"] | undefined,
) {
  const reasoningEffort = normalizeResponsesReasoningEffort(
    requestEffort === undefined ? serviceConfig.responsesReasoningEffort : requestEffort,
  );
  return {
    reasoningEffort,
    reasoningPayload: reasoningEffort === "default"
      ? {}
      : {
        reasoning: {
          effort: reasoningEffort,
        },
      },
  };
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

function isStreamableResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson");
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
  const { reasoningEffort, reasoningPayload } = resolveReasoningPayload(serviceConfig, options.responsesReasoningEffort);
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

  const endpoint = resolveResponsesEndpoint(serviceConfig.baseUrl);
  const requests = Array.from({ length: count }).map(async (_, index) => {
    const controller = createLinkedAbortController(options.signal, SSE_STREAM_TIMEOUT_MS);
    try {
      logger.info("openai-client", "responses-service:generate:start", {
        endpoint,
        model,
        requestIndex: index + 1,
        total: count,
        size,
        quality,
        outputFormat,
        reasoningEffort,
        streaming: true,
        promptLength: normalizedPrompt.length,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          ...reasoningPayload,
          stream: true,
          input: normalizedPrompt,
          tools: [
            {
              type: "image_generation",
              action: "generate",
              output_format: outputFormat,
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
        const bodyText = (await response.text()).slice(0, 200);
        throw buildHttpImageError(
          bodyText || `responses api failed: ${response.status}`,
          response.status,
          "api_service",
          "submit_failed",
          { retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")) },
        );
      }

      let items: ParsedResponsesImageItem[];

      if (response.body && isStreamableResponse(response)) {
        const collector = await consumeSSEStream(response.body, controller.signal);
        items = resolveCollectorResults(collector);
        if (items.length > 0) {
          const sourceType = collector.finalItems.length > 0 ? "final" : "partial";
          logger.info("openai-client", "responses-service:generate:stream-complete", {
            requestIndex: index + 1,
            imageCount: items.length,
            sourceType,
          });
        }
      } else {
        const payload = (await response.json()) as Record<string, unknown>;
        items = parseResponsesImageOutputs(payload);
      }

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
      if (controller.parentAborted() || (isAbortError(error) && !controller.timedOut())) {
        throw createAbortError();
      }
      const isAbort = isAbortError(error);
      const message = error instanceof Error ? error.message : String(error);
      throw createImageError(isAbort ? "responses image request timed out" : message, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "api_service",
      });
    } finally {
      controller.cleanup();
    }
  });

  const settled = await Promise.allSettled(requests);
  throwIfAborted(options.signal);
  const fulfilled = settled
    .filter((entry): entry is PromiseFulfilledResult<ParsedResponsesImageItem[]> => entry.status === "fulfilled")
    .flatMap((entry) => entry.value);
  const rejections = settled
    .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
    .map((entry) => (entry.reason instanceof Error ? entry.reason.message : String(entry.reason)).slice(0, 200));
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
  if (rejections.length > 0) {
    logger.warn("openai-client", "responses-service:generate:partial-failures", {
      endpoint,
      requested: count,
      fulfilled: fulfilled.length,
      failed: rejections.length,
      reasons: rejections,
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
    format?: ImageOutputFormat;
    responsesReasoningEffort?: ImageGenerationOptions["responsesReasoningEffort"];
    continuation?: ResponsesContinuationOptions | null;
    signal?: AbortSignal;
    operation?: "edit" | "upscale";
  },
) {
  const apiKey = cleanToken(serviceConfig.apiKey);
  const prompt = cleanToken(params.prompt);
  const model = cleanToken(serviceConfig.responsesModel) || "gpt-5.5";
  const { reasoningEffort, reasoningPayload } = resolveReasoningPayload(serviceConfig, params.responsesReasoningEffort);
  const previousResponseId = cleanToken(params.continuation?.previousResponseId);
  const imageGenerationCallId = cleanToken(params.continuation?.imageGenerationCallId);
  const size = params.size ?? "auto";
  const quality = params.quality ?? "auto";
  const outputFormat = params.format ?? "png";
  const images = params.images.filter(Boolean);
  const operation = params.operation ?? "edit";
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

  const endpoint = resolveResponsesEndpoint(serviceConfig.baseUrl);
  const useDataUrlInputs = !params.mask;
  const uploadedImageIds = useDataUrlInputs ? [] : await Promise.all(images.map((image) => uploadInputFile(serviceConfig, image, params.signal)));
  const maskFileId = params.mask ? await uploadInputFile(serviceConfig, params.mask, params.signal) : null;
  throwIfAborted(params.signal);
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

  const controller = createLinkedAbortController(params.signal, SSE_STREAM_TIMEOUT_MS);
  try {
    logger.info("openai-client", `responses-service:${operation}:start`, {
      endpoint,
      model,
      imageCount: images.length,
      hasMask: Boolean(maskFileId),
      inputMode: useDataUrlInputs ? "image_url" : "file_id",
      hasPreviousResponseId: Boolean(previousResponseId),
      hasImageGenerationCallId: Boolean(imageGenerationCallId),
      size,
      quality,
      outputFormat,
      reasoningEffort,
      streaming: true,
      promptLength: prompt.length,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        ...reasoningPayload,
        stream: true,
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
            output_format: outputFormat,
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
      const bodyText = (await response.text()).slice(0, 200);
      throw buildHttpImageError(
        bodyText || `responses ${operation} api failed: ${response.status}`,
        response.status,
        "api_service",
        "submit_failed",
        { retryAfterMs: parseRetryAfterHeader(response.headers.get("retry-after")) },
      );
    }

    let items: ParsedResponsesImageItem[];

    if (response.body && isStreamableResponse(response)) {
      const collector = await consumeSSEStream(response.body, controller.signal);
      items = resolveCollectorResults(collector);
      if (items.length > 0) {
        const sourceType = collector.finalItems.length > 0 ? "final" : "partial";
        logger.info("openai-client", `responses-service:${operation}:stream-complete`, {
          imageCount: items.length,
          sourceType,
        });
      }
    } else {
      const payload = (await response.json()) as Record<string, unknown>;
      items = parseResponsesImageOutputs(payload);
    }

    if (items.length === 0) {
      throw createImageError(`no image returned from responses ${operation} api service`, {
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
    if (controller.parentAborted() || (isAbortError(error) && !controller.timedOut())) {
      throw createAbortError();
    }
    const isAbort = isAbortError(error);
    const message = error instanceof Error ? error.message : String(error);
    throw createImageError(isAbort ? `responses ${operation} request timed out` : message, {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  } finally {
    controller.cleanup();
  }
}
