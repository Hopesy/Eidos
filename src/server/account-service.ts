import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import { createAccountAdminService } from "@/server/account/admin-service";
import { createAccountSelector } from "@/server/account/selection-service";
import { createAccountPoolImageRunner } from "@/server/account/pool/image-runner";
import { createAccountRemoteRefreshService } from "@/server/account/remote-refresh-service";
import { createImageRecoveryService } from "@/server/image/recovery-service";
import { getImageApiServiceConfig } from "@/server/image/api-service/service-config";
import { runApiEditTask, runApiGenerateTask, runApiUpscaleTask } from "@/server/image/api-service/task-runner";
import { logger } from "@/server/logger";
import { getSavedConfig } from "@/server/repositories/config";
import type { AccountRecord } from "@/server/types";
import { sanitizeConfigPayload } from "@/shared/app-config";

export { getImageApiServiceConfig } from "@/server/image/api-service/service-config";

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

let accountWatcherTimer: ReturnType<typeof setInterval> | null = null;
let accountWatcherIntervalMs = 0;
let accountWatcherRunning = false;

function getAccountWatcherConfig() {
  const savedConfig = sanitizeConfigPayload(getSavedConfig());
  const intervalMinutes = savedConfig.accounts?.refreshInterval ?? 5;
  return {
    enabled: Boolean(savedConfig.accounts?.autoRefresh),
    intervalMinutes,
    intervalMs: intervalMinutes * 60_000,
  };
}

function clearAccountWatcherTimer() {
  if (!accountWatcherTimer) {
    return;
  }
  clearInterval(accountWatcherTimer);
  accountWatcherTimer = null;
  accountWatcherIntervalMs = 0;
}

async function runAccountWatcherRefresh(reason: "interval") {
  if (accountWatcherRunning) {
    logger.warn("account-service", "账号自动刷新仍在执行，跳过本轮", { reason });
    return;
  }

  accountWatcherRunning = true;
  try {
    const accessTokens = await listTokens();
    if (accessTokens.length === 0) {
      logger.info("account-service", "账号自动刷新跳过：暂无账号", { reason });
      return;
    }

    const result = await refreshAccounts(accessTokens, { markRefreshedAt: true });
    logger.info("account-service", "账号自动刷新完成", {
      reason,
      total: accessTokens.length,
      refreshed: result.refreshed,
      errors: result.errors.length,
    });
  } catch (error) {
    logger.error("account-service", "账号自动刷新失败", {
      reason,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    accountWatcherRunning = false;
  }
}

export async function listAccounts() {
  await ensureAccountWatcherStarted();
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
    imageFormat?: ImageOutputFormat;
    signal?: AbortSignal;
  } = {},
) {
  const route = options.route ?? "generations";
  const operation = options.operation ?? "generate";
  const imageSize = options.imageSize ?? "auto";
  const imageQuality = options.imageQuality ?? "auto";
  const imageFormat = options.imageFormat ?? "png";
  const imageApiService = getImageApiServiceConfig();

  logger.info("account-service", "开始图片生成", {
    model,
    count,
    size: imageSize,
    quality: imageQuality,
    format: imageFormat,
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
      imageFormat,
      startedAt,
      startedAtMs: startTime,
      signal: options.signal,
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
    imageFormat,
    signal: options.signal,
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
    imageFormat?: ImageOutputFormat;
    signal?: AbortSignal;
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
    signal?: AbortSignal;
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
      imageFormat: options.imageFormat,
      sourceReference: options.sourceReference,
      startedAt,
      startedAtMs,
      signal: options.signal,
    },
  );
}

export async function upscaleWithPool(
  prompt: string,
  model: string,
  image: File,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
    imageFormat?: ImageOutputFormat;
    signal?: AbortSignal;
  } = {},
) {
  return accountPoolImageRunner.upscale(prompt, model, image, options);
}

export async function upscaleWithApiService(
  prompt: string,
  model: string,
  image: File,
  options: {
    imageSize?: ImageGenerationSize;
    imageQuality?: ImageGenerationQuality;
    imageFormat?: ImageOutputFormat;
    signal?: AbortSignal;
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
      imageSize: options.imageSize,
      imageQuality: options.imageQuality,
      imageFormat: options.imageFormat,
      startedAt,
      startedAtMs,
      signal: options.signal,
    },
  );
}

export async function ensureAccountWatcherStarted(options: { reload?: boolean } = {}) {
  const config = getAccountWatcherConfig();
  if (!config.enabled) {
    if (accountWatcherTimer) {
      logger.info("account-service", "账号自动刷新已停止");
    }
    clearAccountWatcherTimer();
    return;
  }

  if (!options.reload && accountWatcherTimer && accountWatcherIntervalMs === config.intervalMs) {
    return;
  }

  clearAccountWatcherTimer();
  accountWatcherIntervalMs = config.intervalMs;
  accountWatcherTimer = setInterval(() => {
    void runAccountWatcherRefresh("interval");
  }, config.intervalMs);
  accountWatcherTimer.unref?.();

  logger.info("account-service", "账号自动刷新已启动", {
    intervalMinutes: config.intervalMinutes,
  });
}

export async function recoverImageTaskWithAccount(
  params: {
    conversationId: string;
    sourceAccountId?: string;
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
) {
  return imageRecoveryService.recoverImageTaskWithAccount(params, requestMeta);
}
