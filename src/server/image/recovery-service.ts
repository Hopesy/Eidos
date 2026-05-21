import { persistImageResponseItems } from "@/server/repositories/image/file-repository";
import { createAbortError, isAbortError, throwIfAborted } from "@/server/image/abort";
import { resolveImageErrorStatus } from "@/server/image/error-status";
import {
  getImageErrorMeta,
  ImageGenerationError,
  recoverImageResult,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/repositories/request-log";
import type { AccountRecord } from "@/server/types";

export type ImageRecoveryServiceDependencies = {
  getAccountById(accountId: string): Promise<AccountRecord | null>;
};

export type ImageRecoveryService = {
  recoverImageTaskWithAccount(
    params: {
      conversationId: string;
      sourceAccountId?: string;
      upstreamParentMessageId?: string;
      revisedPrompt?: string;
      fileIds?: string[];
      waitMs?: number;
      model: string;
      signal?: AbortSignal;
    },
    requestMeta: {
      endpoint: string;
      operation: string;
      route: string;
      count: number;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
};

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

type InFlightEntry = {
  promise: Promise<{ created: number; data: Array<Record<string, unknown>> }>;
};

function awaitWithOwnSignal(
  shared: Promise<{ created: number; data: Array<Record<string, unknown>> }>,
  signal?: AbortSignal,
): Promise<{ created: number; data: Array<Record<string, unknown>> }> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (isAbortError(error) && !signal.aborted) {
          reject(new ImageGenerationError("recovery was canceled by another caller", {
            kind: "submit_failed",
            retryAction: "resubmit",
            retryable: true,
            stage: "poll",
          }));
        } else {
          reject(error);
        }
      },
    );
  });
}

export function createImageRecoveryService(
  dependencies: ImageRecoveryServiceDependencies,
): ImageRecoveryService {
  const inFlightRecoveries = new Map<string, InFlightEntry>();

  return {
    async recoverImageTaskWithAccount(params, requestMeta) {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();
      const conversationId = cleanToken(params.conversationId);
      throwIfAborted(params.signal);
      if (!conversationId) {
        throw new ImageGenerationError("conversation id is required", {
          kind: "input_blocked",
          retryAction: "none",
          retryable: false,
          stage: "validation",
        });
      }

      const existing = inFlightRecoveries.get(conversationId);
      if (existing) {
        return awaitWithOwnSignal(existing.promise, params.signal);
      }

      const account = await dependencies.getAccountById(params.sourceAccountId || "");
      if (!account) {
        const error = new ImageGenerationError("无法恢复原始账号，请重新提交任务", {
          kind: "account_blocked",
          retryAction: "switch_account",
          retryable: false,
          stage: "account",
          upstreamConversationId: conversationId,
          upstreamParentMessageId: cleanToken(params.upstreamParentMessageId),
          sourceAccountId: cleanToken(params.sourceAccountId),
        });
        addRequestLog({
          startedAt,
          finishedAt: new Date().toISOString(),
          endpoint: requestMeta.endpoint,
          operation: requestMeta.operation,
          route: requestMeta.route,
          model: params.model,
          count: requestMeta.count,
          success: false,
          error: error.message,
          durationMs: Date.now() - startTime,
          attemptCount: 1,
          finalStatus: "failed",
          statusCode: error.statusCode,
          ...getImageErrorMeta(error),
        });
        throw error;
      }

      const secondCheck = inFlightRecoveries.get(conversationId);
      if (secondCheck) {
        return awaitWithOwnSignal(secondCheck.promise, params.signal);
      }

      const recoveryPromise = (async () => {
        try {
          const result = await recoverImageResult(account.access_token, params.model, account, {
            conversationId,
            parentMessageId: params.upstreamParentMessageId,
            fileIds: params.fileIds,
            revisedPrompt: params.revisedPrompt,
            waitMs: params.waitMs,
            signal: params.signal,
          }) as { created: number; data: Array<Record<string, unknown>> };

          throwIfAborted(params.signal);
          result.data = await persistImageResponseItems(result.data, {
            route: requestMeta.route,
            operation: requestMeta.operation,
            model: params.model,
            prompt: params.revisedPrompt ?? "",
            accountEmail: account.email ?? null,
            accountType: account.type ?? null,
          }, { keepBase64: true });

          addRequestLog({
            startedAt,
            finishedAt: new Date().toISOString(),
            endpoint: requestMeta.endpoint,
            operation: requestMeta.operation,
            route: requestMeta.route,
            model: params.model,
            count: requestMeta.count,
            success: true,
            durationMs: Date.now() - startTime,
            accountEmail: account.email ?? undefined,
            accountType: account.type ?? undefined,
            attemptCount: 1,
            finalStatus: "success",
          });

          return result;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          if (error instanceof ImageGenerationError) {
            if (!error.sourceAccountId) {
              error.sourceAccountId = cleanToken(params.sourceAccountId);
            }
            if (!error.upstreamParentMessageId) {
              error.upstreamParentMessageId = cleanToken(params.upstreamParentMessageId);
            }
          }
          const message = error instanceof Error ? error.message : String(error);
          addRequestLog({
            startedAt,
            finishedAt: new Date().toISOString(),
            endpoint: requestMeta.endpoint,
            operation: requestMeta.operation,
            route: requestMeta.route,
            model: params.model,
            count: requestMeta.count,
            success: false,
            error: message.slice(0, 300),
            durationMs: Date.now() - startTime,
            accountEmail: account.email ?? undefined,
            accountType: account.type ?? undefined,
            attemptCount: 1,
            finalStatus: "failed",
            statusCode: error instanceof ImageGenerationError ? error.statusCode ?? resolveImageErrorStatus(error) : undefined,
            ...getImageErrorMeta(error),
          });
          throw error;
        }
      })();

      inFlightRecoveries.set(conversationId, { promise: recoveryPromise });
      recoveryPromise.finally(() => {
        if (inFlightRecoveries.get(conversationId)?.promise === recoveryPromise) {
          inFlightRecoveries.delete(conversationId);
        }
      });

      return recoveryPromise;
    },
  };
}
