import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { persistImageResponseItems } from "@/server/image-file-store";
import { logger } from "@/server/logger";
import {
  generateImageResultWithAttachments,
  getImageErrorMeta,
  ImageGenerationError,
  isTokenInvalidError,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/request-log-store";

import type { AccountPoolImageRunnerDependencies } from "./account-pool-image-runner-types";
import { cleanToken, isRetryableImageError } from "./account-pool-image-runner-shared";

export async function runAttachmentTaskWithPool(
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
