import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { persistImageResponseItems } from "@/server/repositories/image/file-repository";
import { logger } from "@/server/logger";
import {
  generateImageResultWithApiService,
  generateImageResultWithResponsesApiService,
  getImageErrorMeta,
  ImageGenerationError,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/repositories/request-log";

import {
  API_MAX_ATTEMPTS,
  delay,
  getApiRetryDelayMs,
  isRetryableApiError,
} from "./task-retry-policy";
import type { ImageApiServiceConfig, ImageApiTaskResult } from "./service-config";

async function invokeGenerateWithApiService(
  imageApiService: ImageApiServiceConfig,
  prompt: string,
  model: string,
  count: number,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
  } = {},
) {
  return imageApiService.apiStyle === "responses"
    ? generateImageResultWithResponsesApiService(imageApiService, prompt, model, count, {
      size: options.imageSize,
      quality: options.imageQuality,
    })
    : generateImageResultWithApiService(imageApiService, prompt, model, count, {
      size: options.imageSize,
      quality: options.imageQuality,
    });
}

export async function runApiGenerateTask(
  imageApiService: ImageApiServiceConfig,
  prompt: string,
  model: string,
  count: number,
  options: {
    route: string;
    operation: string;
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
    startedAt: string;
    startedAtMs: number;
  },
) {
  let created: number | null = null;
  const collected: Array<Record<string, unknown>> = [];
  const lastErrors: string[] = [];
  let lastImageError: ImageGenerationError | null = null;
  let attemptCount = 0;

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS && collected.length < count; attempt += 1) {
    attemptCount = attempt;
    const needed = count - collected.length;
    logger.info("account-service", `图像 API 第 ${attempt} 次请求，还需 ${needed} 张`, {
      model,
      endpoint: imageApiService.baseUrl,
      apiStyle: imageApiService.apiStyle,
    });

    try {
      const result = await invokeGenerateWithApiService(imageApiService, prompt, model, needed, {
        imageSize: options.imageSize,
        imageQuality: options.imageQuality,
      }) as ImageApiTaskResult;

      if (created === null) {
        created = Number(result.created || Math.floor(Date.now() / 1000));
      }
      if (Array.isArray(result.data) && result.data.length > 0) {
        collected.push(...result.data);
      }

      logger.info("account-service", `图像 API 第 ${attempt} 次请求成功`, {
        requested: needed,
        returned: Array.isArray(result.data) ? result.data.length : 0,
        accumulated: collected.length,
        target: count,
        elapsedMs: Date.now() - options.startedAtMs,
      });

      if (collected.length >= count) {
        break;
      }

      const partialMessage = `请求 ${count} 张，当前累计 ${collected.length} 张`;
      lastErrors.push(partialMessage);
      if (attempt < API_MAX_ATTEMPTS) {
        const waitMs = getApiRetryDelayMs(attempt, null);
        logger.warn("account-service", "图像 API 返回数量不足，准备重试补齐", {
          model,
          requested: count,
          accumulated: collected.length,
          nextWaitMs: waitMs,
        });
        await delay(waitMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      lastImageError = error instanceof ImageGenerationError ? error : lastImageError;
      logger.error("account-service", `图像 API 第 ${attempt} 次请求失败`, {
        model,
        count,
        error: message.slice(0, 200),
        ...getImageErrorMeta(error),
      });

      if (isRetryableApiError(error) && attempt < API_MAX_ATTEMPTS) {
        const waitMs = getApiRetryDelayMs(attempt, error);
        logger.warn("account-service", "图像 API 错误可重试，准备再次请求", {
          model,
          count,
          nextAttempt: attempt + 1,
          nextWaitMs: waitMs,
          ...getImageErrorMeta(error),
        });
        await delay(waitMs);
        continue;
      }
      break;
    }
  }

  const persisted = await persistImageResponseItems(collected, {
    route: options.route,
    operation: options.operation,
    model,
    prompt,
    accountEmail: "图像 API 服务",
    accountType: "api_service",
  }, { keepBase64: true });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - options.startedAtMs;
  const isComplete = persisted.length >= count;
  const partialError = isComplete
    ? undefined
    : (lastErrors[lastErrors.length - 1] || `请求 ${count} 张，实际返回 ${persisted.length} 张`);

  addRequestLog({
    startedAt: options.startedAt,
    finishedAt,
    endpoint: `POST /v1/images/${options.route}`,
    operation: options.operation,
    route: options.route,
    model,
    count,
    success: isComplete,
    error: partialError?.slice(0, 300),
    durationMs,
    accountEmail: "图像 API 服务",
    accountType: "api_service",
    attemptCount,
    finalStatus: isComplete ? "success" : "partial",
    apiStyle: imageApiService.apiStyle,
    statusCode: lastImageError?.statusCode,
    ...getImageErrorMeta(lastImageError),
  });

  if (persisted.length === 0) {
    if (lastImageError) {
      throw lastImageError;
    }
    throw new ImageGenerationError(lastErrors[lastErrors.length - 1] || "image generation failed", {
      kind: "submit_failed",
      retryAction: "resubmit",
      retryable: true,
      stage: "api_service",
    });
  }

  if (!isComplete) {
    logger.warn("account-service", "图像 API 部分完成", {
      model,
      count,
      got: persisted.length,
      elapsedMs: durationMs,
      lastError: partialError ?? null,
    });
  } else {
    logger.info("account-service", "图像 API 服务生成完成", {
      model,
      count,
      got: persisted.length,
      elapsedMs: durationMs,
    });
  }

  return {
    created: created ?? Math.floor(Date.now() / 1000),
    data: persisted.slice(0, count),
  };
}
