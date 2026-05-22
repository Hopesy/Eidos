import type {
  ImageGenerationQuality,
  ImageGenerationSize,
  ImageOutputFormat,
  ResponsesReasoningEffort,
} from "@/lib/api";
import {
  editImageResultWithApiService,
  editImageResultWithResponsesApiService,
} from "@/server/providers/openai-client";

import { runApiGenerateTask } from "./generate-runner";
import { runApiSingleTask } from "./single-runner";
import type { ImageApiServiceConfig } from "./service-config";

export { runApiGenerateTask } from "./generate-runner";

export function runApiEditTask(
  imageApiService: ImageApiServiceConfig,
  prompt: string,
  model: string,
  images: File[],
  mask: File | null | undefined,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
    imageFormat?: ImageOutputFormat;
    responsesReasoningEffort?: ResponsesReasoningEffort;
    sourceReference?: {
      originalFileId?: string;
      originalGenId?: string;
      previousResponseId?: string;
      imageGenerationCallId?: string;
      conversationId?: string;
      parentMessageId?: string;
      sourceAccountId?: string;
    } | null;
    startedAt: string;
    startedAtMs: number;
    signal?: AbortSignal;
  },
) {
  return runApiSingleTask(
    imageApiService,
    () => imageApiService.apiStyle === "responses"
      ? editImageResultWithResponsesApiService(imageApiService, {
        prompt,
        images,
        mask,
        size: options.imageSize,
        quality: options.imageQuality,
        format: options.imageFormat,
        responsesReasoningEffort: options.responsesReasoningEffort,
        signal: options.signal,
        continuation: options.sourceReference
          ? {
            previousResponseId: options.sourceReference.previousResponseId,
            imageGenerationCallId: options.sourceReference.imageGenerationCallId,
          }
          : null,
      })
      : editImageResultWithApiService(imageApiService, {
        prompt,
        model,
        images,
        mask,
        size: options.imageSize,
        quality: options.imageQuality,
        format: options.imageFormat,
        signal: options.signal,
      }),
    {
      endpoint: "POST /v1/images/edits",
      route: "edits",
      operation: "edit",
      model,
      prompt,
      count: 1,
      startedAt: options.startedAt,
      startedAtMs: options.startedAtMs,
      signal: options.signal,
    },
  );
}

export function runApiUpscaleTask(
  imageApiService: ImageApiServiceConfig,
  prompt: string,
  model: string,
  image: File,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
    imageFormat?: ImageOutputFormat;
    responsesReasoningEffort?: ResponsesReasoningEffort;
    sourceReference?: {
      originalFileId?: string;
      originalGenId?: string;
      previousResponseId?: string;
      imageGenerationCallId?: string;
      conversationId?: string;
      parentMessageId?: string;
      sourceAccountId?: string;
    } | null;
    startedAt: string;
    startedAtMs: number;
    signal?: AbortSignal;
  },
) {
  return runApiSingleTask(
    imageApiService,
    () => imageApiService.apiStyle === "responses"
      ? editImageResultWithResponsesApiService(imageApiService, {
        prompt,
        images: [image],
        size: options.imageSize,
        quality: options.imageQuality,
        format: options.imageFormat,
        responsesReasoningEffort: options.responsesReasoningEffort,
        signal: options.signal,
        operation: "upscale",
        continuation: options.sourceReference
          ? {
            previousResponseId: options.sourceReference.previousResponseId,
            imageGenerationCallId: options.sourceReference.imageGenerationCallId,
          }
          : null,
      })
      : editImageResultWithApiService(imageApiService, {
        prompt,
        model,
        images: [image],
        size: options.imageSize,
        quality: options.imageQuality,
        format: options.imageFormat,
        signal: options.signal,
      }),
    {
      endpoint: "POST /v1/images/upscale",
      route: "upscale",
      operation: "upscale",
      model,
      prompt,
      count: 1,
      startedAt: options.startedAt,
      startedAtMs: options.startedAtMs,
      signal: options.signal,
      successLogMessage: "图像 API 图片增强完成",
      successLogData: { model, size: options.imageSize ?? "auto", quality: options.imageQuality ?? "medium", format: options.imageFormat ?? "png" },
    },
  );
}
