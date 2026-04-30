import { persistImageResponseItems } from "@/server/repositories/image-file-repository";
import { logger } from "@/server/logger";
import {
  getImageErrorMeta,
  ImageGenerationError,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/repositories/request-log-repository";

import {
  API_MAX_ATTEMPTS,
  delay,
  getApiRetryDelayMs,
  isRetryableApiError,
} from "./image-api-task-retry-policy";
import type { ImageApiServiceConfig, ImageApiTaskResult } from "./image-api-task-runner-types";

export async function runApiSingleTask<T extends ImageApiTaskResult>(
  imageApiService: ImageApiServiceConfig,
  invoke: () => Promise<T>,
  options: {
    endpoint: string;
    route: string;
    operation: string;
    model: string;
    prompt: string;
    count: number;
    startedAt: string;
    startedAtMs: number;
    successLogMessage?: string;
    successLogData?: Record<string, unknown>;
  },
) {
  const lastErrors: string[] = [];
  let lastImageError: ImageGenerationError | null = null;
  let attemptCount = 0;

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt += 1) {
    attemptCount = attempt;
    logger.info("account-service", `图像 API ${options.operation} 第 ${attempt} 次请求开始`, {
      model: options.model,
      endpoint: imageApiService.baseUrl,
      apiStyle: imageApiService.apiStyle,
    });

    try {
      const result = await invoke();
      result.data = await persistImageResponseItems(result.data, {
        route: options.route,
        operation: options.operation,
        model: options.model,
        prompt: options.prompt,
        accountEmail: "图像 API 服务",
        accountType: "api_service",
      }, { keepBase64: true });

      addRequestLog({
        startedAt: options.startedAt,
        finishedAt: new Date().toISOString(),
        endpoint: options.endpoint,
        operation: options.operation,
        route: options.route,
        model: options.model,
        count: options.count,
        success: true,
        durationMs: Date.now() - options.startedAtMs,
        accountEmail: "图像 API 服务",
        accountType: "api_service",
        attemptCount,
        finalStatus: "success",
        apiStyle: imageApiService.apiStyle,
      });

      if (options.successLogMessage) {
        logger.info("account-service", options.successLogMessage, {
          elapsedMs: Date.now() - options.startedAtMs,
          accountEmail: "图像 API 服务",
          ...options.successLogData,
        });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      lastImageError = error instanceof ImageGenerationError ? error : lastImageError;
      logger.error("account-service", `图像 API ${options.operation} 第 ${attempt} 次请求失败`, {
        model: options.model,
        error: message.slice(0, 200),
        ...getImageErrorMeta(error),
      });

      if (isRetryableApiError(error) && attempt < API_MAX_ATTEMPTS) {
        const waitMs = getApiRetryDelayMs(attempt, error);
        logger.warn("account-service", `图像 API ${options.operation} 错误可重试，准备再次请求`, {
          model: options.model,
          nextAttempt: attempt + 1,
          nextWaitMs: waitMs,
          ...getImageErrorMeta(error),
        });
        await delay(waitMs);
        continue;
      }

      addRequestLog({
        startedAt: options.startedAt,
        finishedAt: new Date().toISOString(),
        endpoint: options.endpoint,
        operation: options.operation,
        route: options.route,
        model: options.model,
        count: options.count,
        success: false,
        error: message.slice(0, 300),
        durationMs: Date.now() - options.startedAtMs,
        accountEmail: "图像 API 服务",
        accountType: "api_service",
        attemptCount,
        finalStatus: "failed",
        apiStyle: imageApiService.apiStyle,
        statusCode: error instanceof ImageGenerationError ? error.statusCode : undefined,
        ...getImageErrorMeta(error),
      });
      throw error;
    }
  }

  if (lastImageError) {
    throw lastImageError;
  }
  throw new ImageGenerationError(lastErrors[lastErrors.length - 1] || "image api task failed", {
    kind: "submit_failed",
    retryAction: "resubmit",
    retryable: true,
    stage: "api_service",
  });
}
