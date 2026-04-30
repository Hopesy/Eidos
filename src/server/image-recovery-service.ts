import { persistImageResponseItems } from "@/server/repositories/image-file-repository";
import {
  getImageErrorMeta,
  ImageGenerationError,
  recoverImageResult,
} from "@/server/providers/openai-client";
import { addRequestLog } from "@/server/repositories/request-log-repository";
import type { AccountRecord } from "@/server/types";

export type ImageRecoveryServiceDependencies = {
  getAccountById(accountId: string): Promise<AccountRecord | null>;
};

export type ImageRecoveryService = {
  recoverImageTaskWithAccount(
    params: {
      conversationId: string;
      sourceAccountId?: string;
      revisedPrompt?: string;
      fileIds?: string[];
      waitMs?: number;
      model: string;
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

export function createImageRecoveryService(
  dependencies: ImageRecoveryServiceDependencies,
): ImageRecoveryService {
  return {
    async recoverImageTaskWithAccount(params, requestMeta) {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();
      const conversationId = cleanToken(params.conversationId);
      if (!conversationId) {
        throw new ImageGenerationError("conversation id is required", {
          kind: "input_blocked",
          retryAction: "none",
          retryable: false,
          stage: "validation",
        });
      }

      const account = await dependencies.getAccountById(params.sourceAccountId || "");
      if (!account) {
        const error = new ImageGenerationError("无法恢复原始账号，请重新提交任务", {
          kind: "account_blocked",
          retryAction: "switch_account",
          retryable: false,
          stage: "account",
          upstreamConversationId: conversationId,
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

      const result = await recoverImageResult(account.access_token, params.model, account, {
        conversationId,
        fileIds: params.fileIds,
        revisedPrompt: params.revisedPrompt,
        waitMs: params.waitMs,
      }) as { created: number; data: Array<Record<string, unknown>> };

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
    },
  };
}
