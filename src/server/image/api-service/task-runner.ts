import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
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
    sourceReference?: {
      originalFileId: string;
      originalGenId: string;
      previousResponseId?: string;
      imageGenerationCallId?: string;
      conversationId?: string;
      parentMessageId?: string;
      sourceAccountId?: string;
    } | null;
    startedAt: string;
    startedAtMs: number;
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
        continuation: options.sourceReference
          ? {
            previousResponseId: options.sourceReference.previousResponseId || options.sourceReference.originalGenId,
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
    startedAt: string;
    startedAtMs: number;
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
      })
      : editImageResultWithApiService(imageApiService, {
        prompt,
        model,
        images: [image],
        size: options.imageSize,
        quality: options.imageQuality,
        format: options.imageFormat,
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
      successLogMessage: "图像 API 图片增强完成",
      successLogData: { model, size: options.imageSize ?? "auto", quality: options.imageQuality ?? "medium", format: options.imageFormat ?? "png" },
    },
  );
}
