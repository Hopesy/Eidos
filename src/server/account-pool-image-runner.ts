import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { persistImageResponseItems } from "@/server/image-file-store";
import { logger } from "@/server/logger";
import {
  generateImageResult,
  generateImageResultWithAttachments,
  getImageErrorMeta,
  ImageGenerationError,
  isTokenInvalidError,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/request-log-store";
import type { AccountRecord } from "@/server/types";

export type AccountPoolImageRunnerDependencies = {
  getAvailableAccessToken(excludedTokens?: Set<string>): Promise<string>;
  getAccount(accessToken: string): Promise<AccountRecord | null>;
  markImageResult(accessToken: string, success: boolean): Promise<unknown>;
  removeToken(accessToken: string): Promise<unknown>;
};

export type AccountPoolImageRunner = {
  generate(
    prompt: string,
    model: string,
    count: number,
    options?: {
      route?: string;
      operation?: string;
      imageSize?: ImageGenerationSize;
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
  edit(
    prompt: string,
    model: string,
    images: File[],
    mask?: File | null,
    options?: {
      imageSize?: ImageGenerationSize;
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
  upscale(
    prompt: string,
    model: string,
    image: File,
    options?: {
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
};

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

function isRetryableImageError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "switch_account");
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

async function runGenerateTaskWithPool(
  dependencies: AccountPoolImageRunnerDependencies,
  prompt: string,
  model: string,
  count: number,
  options: {
    route?: string;
    operation?: string;
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
  } = {},
) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  let created: number | null = null;
  const data: Array<Record<string, unknown>> = [];
  const lastErrors: string[] = [];
  let lastImageError: ImageGenerationError | null = null;
  let lastAccountEmail: string | undefined;
  let lastAccountType: string | undefined;
  let attemptCount = 0;

  const route = options.route ?? "generations";
  const operation = options.operation ?? "generate";
  const imageSize = options.imageSize ?? "auto";
  const imageQuality = options.imageQuality ?? "auto";

  let requestIndex = 1;
  while (data.length < count) {
    attemptCount = requestIndex;
    const attempted = new Set<string>();
    const needed = count - data.length;
    logger.info("account-service", `第 ${requestIndex} 次请求，还需 ${needed} 张`, { model });

    let succeeded = false;
    while (true) {
      let requestToken = "";
      try {
        requestToken = await dependencies.getAvailableAccessToken(attempted);
      } catch (noTokenErr) {
        const msg = noTokenErr instanceof Error ? noTokenErr.message : String(noTokenErr);
        lastErrors.push(msg);
        logger.warn("account-service", `第 ${requestIndex} 次请求：无可用 token`, { reason: msg });
        break;
      }

      const tokenHint = requestToken.slice(0, 16) + "...";
      logger.info("account-service", `第 ${requestIndex} 次请求：使用 token`, { token: tokenHint, model });
      const account = await dependencies.getAccount(requestToken);

      try {
        if (account) {
          lastAccountEmail = account.email ?? undefined;
          lastAccountType = account.type ?? undefined;
        }
        const result = await generateImageResult(requestToken, prompt, model, account, {
          size: imageSize,
          quality: imageQuality,
        }) as { created: number; data: Array<Record<string, unknown>> };
        result.data = result.data.map((item) => ({
          ...item,
          source_account_id: cleanToken(account?.id),
        }));
        result.data = await persistImageResponseItems(result.data, {
          route,
          operation,
          model,
          prompt,
          accountEmail: account?.email ?? null,
          accountType: account?.type ?? null,
        }, { keepBase64: true });
        await dependencies.markImageResult(requestToken, true);
        if (created === null) {
          created = Number(result.created || Math.floor(Date.now() / 1000));
        }
        if (Array.isArray(result.data)) {
          data.push(...result.data);
        }
        logger.info("account-service", `第 ${requestIndex} 次请求：成功，累计 ${data.length}/${count} 张`, {
          token: tokenHint,
          elapsedMs: Date.now() - startTime,
        });
        succeeded = true;
        break;
      } catch (error) {
        await dependencies.markImageResult(requestToken, false);
        const message = error instanceof Error ? error.message : String(error);
        lastErrors.push(message);
        lastImageError = error instanceof ImageGenerationError ? error : lastImageError;
        if (error instanceof ImageGenerationError) {
          error.sourceAccountId = cleanToken(account?.id);
        }
        logger.error("account-service", `第 ${requestIndex} 次请求：失败`, {
          token: tokenHint,
          error: message.slice(0, 200),
          ...getImageErrorMeta(error),
        });
        if (isTokenInvalidError(message)) {
          logger.warn("account-service", "Token 无效，自动移除", { token: tokenHint });
          await dependencies.removeToken(requestToken);
          attempted.add(requestToken);
          continue;
        }
        if (isRetryableImageError(error)) {
          logger.warn("account-service", `第 ${requestIndex} 次请求：错误可重试，切换下一个 token`, {
            token: tokenHint,
            error: message.slice(0, 200),
            ...getImageErrorMeta(error),
          });
          attempted.add(requestToken);
          continue;
        }
        break;
      }
    }

    requestIndex += 1;
    // 若本次请求未成功（无可用 token 或非 token 问题错误），退出外循环避免死循环
    if (!succeeded) {
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  if (data.length === 0) {
    const detail = lastErrors.length > 0 ? lastErrors[lastErrors.length - 1] : "no available accounts";
    const errMsg = `image generation failed: ${detail}`;
    logger.error("account-service", "图片生成全部失败", { model, count, detail, elapsedMs: durationMs });
    addRequestLog({
      startedAt,
      finishedAt,
      endpoint: `POST /v1/images/${route}`,
      operation,
      route,
      model,
      count,
      success: false,
      error: detail.slice(0, 300),
      durationMs,
      accountEmail: lastAccountEmail,
      accountType: lastAccountType,
      attemptCount,
      finalStatus: "failed",
      statusCode: lastImageError?.statusCode,
      ...getImageErrorMeta(lastImageError),
    });
    if (lastImageError) {
      throw lastImageError;
    }
    throw new ImageGenerationError(errMsg, {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: false,
      stage: "account",
    });
  }

  const completedCount = Math.min(data.length, count);
  const isComplete = completedCount === count;
  const partialError = isComplete ? undefined : `请求 ${count} 张，实际返回 ${completedCount} 张`;

  if (!isComplete) {
    logger.warn("account-service", "图片生成部分完成", {
      model,
      count,
      got: completedCount,
      elapsedMs: durationMs,
      lastError: lastErrors[lastErrors.length - 1] ?? null,
    });
  } else {
    logger.info("account-service", "图片生成完成", { model, count, got: completedCount, elapsedMs: durationMs });
  }

  addRequestLog({
    startedAt,
    finishedAt,
    endpoint: `POST /v1/images/${route}`,
    operation,
    route,
    model,
    count,
    success: isComplete,
    error: partialError,
    durationMs,
    accountEmail: lastAccountEmail,
    accountType: lastAccountType,
    attemptCount: Math.max(1, requestIndex - 1),
    finalStatus: isComplete ? "success" : "partial",
    statusCode: lastImageError?.statusCode,
  });
  return {
    created: created ?? Math.floor(Date.now() / 1000),
    data: data.slice(0, count),
  };
}

async function runAttachmentTaskWithPool(
  dependencies: AccountPoolImageRunnerDependencies,
  prompt: string,
  model: string,
  params: {
    images: File[];
    mask?: File | null;
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
  },
  requestMeta: {
    endpoint: string;
    route: string;
    operation: string;
    count: number;
    successLogMessage?: string;
    successLogData?: Record<string, unknown>;
  },
) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const lastErrors: string[] = [];
  let lastImageError: ImageGenerationError | null = null;
  let lastAccountEmail: string | undefined;
  let lastAccountType: string | undefined;
  let attemptCount = 0;

  const attempted = new Set<string>();
  while (true) {
    attemptCount += 1;
    let requestToken = "";
    try {
      requestToken = await dependencies.getAvailableAccessToken(attempted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      break;
    }

    const account = await dependencies.getAccount(requestToken);
    const tokenHint = requestToken.slice(0, 16) + "...";
    if (account) {
      lastAccountEmail = account.email ?? undefined;
      lastAccountType = account.type ?? undefined;
    }

    try {
      const result = await generateImageResultWithAttachments(requestToken, prompt, model, account, params) as {
        created: number;
        data: Array<Record<string, unknown>>;
      };
      result.data = result.data.map((item) => ({
        ...item,
        source_account_id: cleanToken(account?.id),
      }));

      result.data = await persistImageResponseItems(result.data, {
        route: requestMeta.route,
        operation: requestMeta.operation,
        model,
        prompt,
        accountEmail: account?.email ?? null,
        accountType: account?.type ?? null,
      }, { keepBase64: true });

      await dependencies.markImageResult(requestToken, true);
      addRequestLog({
        startedAt,
        finishedAt: new Date().toISOString(),
        endpoint: requestMeta.endpoint,
        operation: requestMeta.operation,
        route: requestMeta.route,
        model,
        count: requestMeta.count,
        success: true,
        durationMs: Date.now() - startTime,
        accountEmail: lastAccountEmail,
        accountType: lastAccountType,
        attemptCount,
        finalStatus: "success",
      });
      if (requestMeta.successLogMessage) {
        logger.info("account-service", requestMeta.successLogMessage, {
          accountEmail: lastAccountEmail ?? null,
          elapsedMs: Date.now() - startTime,
          ...requestMeta.successLogData,
        });
      }
      return result;
    } catch (error) {
      await dependencies.markImageResult(requestToken, false);
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      lastImageError = error instanceof ImageGenerationError ? error : lastImageError;
      if (error instanceof ImageGenerationError) {
        error.sourceAccountId = cleanToken(account?.id);
      }
      logger.error("account-service", `${requestMeta.operation} 请求失败`, {
        token: tokenHint,
        error: message.slice(0, 200),
        ...getImageErrorMeta(error),
      });
      if (isTokenInvalidError(message)) {
        logger.warn("account-service", "Token 无效，自动移除", { token: tokenHint });
        await dependencies.removeToken(requestToken);
        attempted.add(requestToken);
        continue;
      }
      if (isRetryableImageError(error)) {
        logger.warn("account-service", `${requestMeta.operation} 错误可重试，切换下一个 token`, {
          token: tokenHint,
          error: message.slice(0, 200),
          ...getImageErrorMeta(error),
        });
        attempted.add(requestToken);
        continue;
      }

      addRequestLog({
        startedAt,
        finishedAt: new Date().toISOString(),
        endpoint: requestMeta.endpoint,
        operation: requestMeta.operation,
        route: requestMeta.route,
        model,
        count: requestMeta.count,
        success: false,
        error: message.slice(0, 300),
        durationMs: Date.now() - startTime,
        accountEmail: lastAccountEmail,
        accountType: lastAccountType,
        attemptCount,
        finalStatus: "failed",
        statusCode: error instanceof ImageGenerationError ? error.statusCode : undefined,
        ...getImageErrorMeta(error),
      });
      throw error;
    }
  }

  const detail = lastErrors.length > 0 ? lastErrors[lastErrors.length - 1] : "no available accounts";
  addRequestLog({
    startedAt,
    finishedAt: new Date().toISOString(),
    endpoint: requestMeta.endpoint,
    operation: requestMeta.operation,
    route: requestMeta.route,
    model,
    count: requestMeta.count,
    success: false,
    error: detail.slice(0, 300),
    durationMs: Date.now() - startTime,
    accountEmail: lastAccountEmail,
    accountType: lastAccountType,
    attemptCount,
    finalStatus: "failed",
    statusCode: lastImageError?.statusCode,
    ...getImageErrorMeta(lastImageError),
  });
  if (lastImageError) {
    throw lastImageError;
  }
  throw new ImageGenerationError(detail, {
    kind: "account_blocked",
    retryAction: "switch_account",
    retryable: false,
    stage: "account",
  });
}

export function createAccountPoolImageRunner(
  dependencies: AccountPoolImageRunnerDependencies,
): AccountPoolImageRunner {
  return {
    generate(prompt, model, count, options = {}) {
      return runGenerateTaskWithPool(dependencies, prompt, model, count, options);
    },

    edit(prompt, model, images, mask = null, options = {}) {
      return runAttachmentTaskWithPool(
        dependencies,
        prompt,
        model,
        {
          images,
          mask,
          size: options.imageSize,
          quality: options.imageQuality,
        },
        {
          endpoint: "POST /v1/images/edits",
          operation: "edit",
          route: "edits",
          count: 1,
        },
      );
    },

    upscale(prompt, model, image, options = {}) {
      const operation = "upscale";
      return runAttachmentTaskWithPool(
        dependencies,
        prompt,
        model,
        {
          images: [image],
          quality: options.imageQuality,
        },
        {
          endpoint: "POST /v1/images/upscale",
          operation,
          count: 1,
          route: "upscale",
          successLogMessage: "图片增强完成",
          successLogData: { model, quality: options.imageQuality ?? "medium" },
        },
      );
    },
  };
}
