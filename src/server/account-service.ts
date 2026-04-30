import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { createAccountAdminService } from "@/server/account-admin-service";
import { createAccountSelector } from "@/server/account-selection-service";
import { createAccountPoolImageRunner } from "@/server/account-pool-image-runner";
import { createAccountRemoteRefreshService } from "@/server/account-remote-refresh-service";
import { createImageRecoveryService } from "@/server/image-recovery-service";
import { getImageApiServiceConfig } from "@/server/image-api-service-config";
import { runApiEditTask, runApiGenerateTask, runApiUpscaleTask } from "@/server/image-api-task-runner";
import { logger } from "@/server/logger";
import type { AccountRecord } from "@/server/types";

export { getImageApiServiceConfig } from "@/server/image-api-service-config";

const accountAdminService = createAccountAdminService();

const accountRemoteRefreshService = createAccountRemoteRefreshService({
  getAccount: accountAdminService.getAccount,
  updateAccount: accountAdminService.updateAccount,
  listAccounts: accountAdminService.listAccounts,
});

const accountSelector = createAccountSelector({
  listRecords: accountAdminService.listRecords,
  refreshAccountState: accountRemoteRefreshService.refreshAccountState,
});

const accountPoolImageRunner = createAccountPoolImageRunner({
  getAvailableAccessToken,
  getAccount: accountAdminService.getAccount,
  markImageResult: accountAdminService.markImageResult,
  removeToken,
});

const imageRecoveryService = createImageRecoveryService({
  getAccountById: accountAdminService.getAccountById,
});

export async function listAccounts() {
  return accountAdminService.listAccounts();
}

export async function listTokens() {
  return accountAdminService.listTokens();
}

export async function listLimitedTokens() {
  return accountAdminService.listLimitedTokens();
}

export async function addAccounts(tokens: string[]) {
  return accountAdminService.addAccounts(tokens);
}

export async function deleteAccounts(tokens: string[]) {
  const result = await accountAdminService.deleteAccounts(tokens);
  accountSelector.reset(result.items.length);
  return result;
}

export async function removeToken(accessToken: string) {
  const result = await deleteAccounts([accessToken]);
  return result.removed > 0;
}

export async function updateAccount(accessToken: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null> {
  return accountAdminService.updateAccount(accessToken, updates);
}

export async function markImageResult(accessToken: string, success: boolean) {
  return accountAdminService.markImageResult(accessToken, success);
}

export async function fetchAccountRemoteInfo(accessToken: string) {
  return accountRemoteRefreshService.fetchAccountRemoteInfo(accessToken);
}

export async function refreshAccountState(accessToken: string): Promise<AccountRecord | null> {
  return accountRemoteRefreshService.refreshAccountState(accessToken);
}

export async function refreshAccounts(accessTokens: string[], options?: { markRefreshedAt?: boolean }) {
  return accountRemoteRefreshService.refreshAccounts(accessTokens, options);
}

export async function getAvailableAccessToken(excludedTokens?: Set<string>) {
  return accountSelector.getAvailableAccessToken(excludedTokens);
}

export async function generateWithPool(
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
  const route = options.route ?? "generations";
  const operation = options.operation ?? "generate";
  const imageSize = options.imageSize ?? "auto";
  const imageQuality = options.imageQuality ?? "auto";
  const imageApiService = getImageApiServiceConfig();

  logger.info("account-service", "开始图片生成", {
    model,
    count,
    size: imageSize,
    quality: imageQuality,
  });

  if (imageApiService) {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    logger.info("account-service", "图像 API 通道已启用，本次只走图像 API 服务", {
      model,
      count,
      endpoint: imageApiService.baseUrl,
      apiStyle: imageApiService.apiStyle,
    });

    return runApiGenerateTask(imageApiService, prompt, model, count, {
      route,
      operation,
      imageSize,
      imageQuality,
      startedAt,
      startedAtMs: startTime,
    });
  }

  logger.info("account-service", "图像 API 通道未启用，本次只走账号池", {
    model,
    count,
  });

  return accountPoolImageRunner.generate(prompt, model, count, {
    route,
    operation,
    imageSize,
    imageQuality,
  });
}

export async function editWithPool(
  prompt: string,
  model: string,
  images: File[],
  mask?: File | null,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
  } = {},
) {
  return accountPoolImageRunner.edit(prompt, model, images, mask, options);
}

export async function editWithApiService(
  prompt: string,
  model: string,
  images: File[],
  mask?: File | null,
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
  } = {},
) {
  const imageApiService = getImageApiServiceConfig();
  if (!imageApiService) {
    throw new Error("image api service is not enabled");
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  return runApiEditTask(
    imageApiService,
    prompt,
    model,
    images,
    mask,
    {
      imageSize: options.imageSize,
      imageQuality: options.imageQuality,
      sourceReference: options.sourceReference,
      startedAt,
      startedAtMs,
    },
  );
}

export async function upscaleWithPool(
  prompt: string,
  model: string,
  image: File,
  options: {
    imageQuality?: ImageGenerationQuality;
  } = {},
) {
  return accountPoolImageRunner.upscale(prompt, model, image, options);
}

export async function upscaleWithApiService(
  prompt: string,
  model: string,
  image: File,
  options: {
    imageQuality?: ImageGenerationQuality;
  } = {},
) {
  const imageApiService = getImageApiServiceConfig();
  if (!imageApiService) {
    throw new Error("image api service is not enabled");
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  return runApiUpscaleTask(
    imageApiService,
    prompt,
    model,
    image,
    {
      imageQuality: options.imageQuality,
      startedAt,
      startedAtMs,
    },
  );
}

export async function ensureAccountWatcherStarted() {
  // 定期自动刷新已禁用，账号状态由用户手动刷新
}

export async function recoverImageTaskWithAccount(
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
) {
  return imageRecoveryService.recoverImageTaskWithAccount(params, requestMeta);
}
