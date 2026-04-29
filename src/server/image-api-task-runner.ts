import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { persistImageResponseItems } from "@/server/image-file-store";
import { getImageApiServiceConfig } from "@/server/image-api-service-config";
import { logger } from "@/server/logger";
import {
  editImageResultWithApiService,
  editImageResultWithResponsesApiService,
  generateImageResultWithApiService,
  generateImageResultWithResponsesApiService,
  getImageErrorMeta,
  ImageGenerationError,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/request-log-store";

const API_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 1500;

type ImageApiServiceConfig = NonNullable<ReturnType<typeof getImageApiServiceConfig>>;
type ImageApiTaskResult = { created: number; data: Array<Record<string, unknown>> };

function isRetryableApiError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "retry_download");
  }
  const normalized = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("content policy") ||
    normalized.includes("safety") ||
    normalized.includes("policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("bad request") ||
    normalized.includes("400") ||
    normalized.includes("401") ||
    normalized.includes("403")
  ) {
    return false;
  }
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network error") ||
    normalized.includes("request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("terminated") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("und_err") ||
    normalized.includes("socket") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("service unavailable")
  );
}

function getApiRetryDelayMs(attempt: number, error: unknown) {
  const normalizedAttempt = Math.max(1, attempt);
  if (error instanceof ImageGenerationError) {
    if (error.statusCode === 429) {
      return 4000 * normalizedAttempt;
    }
    if (error.stage === "upload") {
      return 1200 * normalizedAttempt;
    }
    if (error.stage === "api_service" || error.stage === "submit") {
      return API_RETRY_BASE_DELAY_MS * (2 ** (normalizedAttempt - 1));
    }
  }
  return API_RETRY_BASE_DELAY_MS * (2 ** (normalizedAttempt - 1));
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function runApiSingleTask<T extends ImageApiTaskResult>(
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

export function runApiEditTask(
  imageApiService: ImageApiServiceConfig,
  prompt: string,
  model: string,
  images: File[],
  mask: File | null | undefined,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
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
    imageQuality?: ImageGenerationQuality;
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
        quality: options.imageQuality,
      })
      : editImageResultWithApiService(imageApiService, {
        prompt,
        model,
        images: [image],
        quality: options.imageQuality,
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
      successLogData: { model, quality: options.imageQuality ?? "medium" },
    },
  );
}
