import { createHash } from "node:crypto";

import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { logger } from "@/server/logger";
import { updateAccounts, readAccounts } from "@/server/store";
import type { AccountRecord, AccountStatus, PublicAccount } from "@/server/types";
import { createAccountSelector } from "@/server/account-selection-service";
import { createAccountPoolImageRunner } from "@/server/account-pool-image-runner";
import { createAccountRemoteRefreshService, normalizeAccountType } from "@/server/account-remote-refresh-service";
import { createImageRecoveryService } from "@/server/image-recovery-service";
import { getImageApiServiceConfig } from "@/server/image-api-service-config";
import { runApiEditTask, runApiGenerateTask, runApiUpscaleTask } from "@/server/image-api-task-runner";

export { getImageApiServiceConfig } from "@/server/image-api-service-config";

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

function dedupeTokens(tokens: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const token of tokens) {
    const normalized = cleanToken(token);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleaned.push(normalized);
  }
  return cleaned;
}

function normalizeAccount(input: Record<string, unknown>): AccountRecord | null {
  const accessToken = cleanToken(input.access_token);
  if (!accessToken) {
    return null;
  }

  const type = normalizeAccountType(input.type) || "Free";
  const status = (cleanToken(input.status) || "正常") as AccountStatus;
  const quota = Math.max(0, Number(input.quota ?? 0) || 0);

  return {
    ...input,
    access_token: accessToken,
    type,
    status: ["正常", "限流", "异常", "禁用"].includes(status) ? status : "正常",
    quota,
    email: cleanToken(input.email) || null,
    user_id: cleanToken(input.user_id) || null,
    limits_progress: Array.isArray(input.limits_progress) ? (input.limits_progress as Array<Record<string, unknown>>) : [],
    default_model_slug: cleanToken(input.default_model_slug) || null,
    restore_at: cleanToken(input.restore_at) || null,
    success: Math.max(0, Number(input.success ?? 0) || 0),
    fail: Math.max(0, Number(input.fail ?? 0) || 0),
    last_used_at: cleanToken(input.last_used_at) || null,
    updated_at: cleanToken(input.updated_at) || null,
    last_refreshed_at: cleanToken(input.last_refreshed_at) || null,
    fp: input.fp && typeof input.fp === "object" ? (input.fp as Record<string, unknown>) : undefined,
  };
}

function publicAccount(account: AccountRecord): PublicAccount {
  return {
    id: createHash("sha1").update(account.access_token).digest("hex").slice(0, 16),
    access_token: account.access_token,
    type: account.type,
    status: account.status,
    quota: account.quota,
    email: account.email,
    user_id: account.user_id,
    limits_progress: account.limits_progress,
    default_model_slug: account.default_model_slug,
    restoreAt: account.restore_at,
    success: account.success,
    fail: account.fail,
    lastUsedAt: account.last_used_at,
    updatedAt: account.updated_at ?? null,
    lastRefreshedAt: account.last_refreshed_at ?? null,
  };
}

async function listRecords() {
  const raw = await readAccounts();
  return raw
    .map((item) => normalizeAccount(item as Record<string, unknown>))
    .filter((item): item is AccountRecord => Boolean(item));
}

async function saveTransformed(
  updater: (accounts: AccountRecord[]) => Promise<AccountRecord[]> | AccountRecord[],
) {
  return updateAccounts(async (accounts) => {
    const normalized = accounts
      .map((item) => normalizeAccount(item as Record<string, unknown>))
      .filter((item): item is AccountRecord => Boolean(item));
    const nextAccounts = await updater(normalized);
    accounts.splice(0, accounts.length, ...nextAccounts);
    return nextAccounts;
  });
}

async function getAccount(accessToken: string) {
  const normalized = cleanToken(accessToken);
  return (await listRecords()).find((item) => item.access_token === normalized) ?? null;
}

async function getAccountById(accountId: string) {
  const normalized = cleanToken(accountId);
  if (!normalized) {
    return null;
  }
  return (await listRecords()).find((item) => cleanToken(item.id) === normalized) ?? null;
}

const accountRemoteRefreshService = createAccountRemoteRefreshService({
  getAccount,
  updateAccount,
  listAccounts,
});

const accountSelector = createAccountSelector({
  listRecords,
  refreshAccountState: accountRemoteRefreshService.refreshAccountState,
});

const accountPoolImageRunner = createAccountPoolImageRunner({
  getAvailableAccessToken,
  getAccount,
  markImageResult,
  removeToken,
});

const imageRecoveryService = createImageRecoveryService({
  getAccountById,
});

export async function listAccounts() {
  return (await listRecords()).map(publicAccount);
}

export async function listTokens() {
  return (await listRecords()).map((item) => item.access_token);
}

export async function listLimitedTokens() {
  return (await listRecords())
    .filter((item) => item.status === "限流")
    .map((item) => item.access_token);
}

export async function addAccounts(tokens: string[]) {
  const incoming = dedupeTokens(tokens);
  if (incoming.length === 0) {
    return { added: 0, skipped: 0, items: await listAccounts() };
  }

  let added = 0;
  let skipped = 0;
  const nextAccounts = await saveTransformed((accounts) => {
    const indexed = new Map(accounts.map((item) => [item.access_token, item] as const));
    for (const accessToken of incoming) {
      const current = indexed.get(accessToken);
      if (current) {
        skipped += 1;
      } else {
        added += 1;
      }
      indexed.set(
        accessToken,
        normalizeAccount({
          ...(current ?? {}),
          access_token: accessToken,
          type: current?.type ?? "Free",
        })!,
      );
    }
    return Array.from(indexed.values());
  });

  return {
    added,
    skipped,
    items: nextAccounts.map(publicAccount),
  };
}

export async function deleteAccounts(tokens: string[]) {
  const target = new Set(dedupeTokens(tokens));
  if (target.size === 0) {
    return { removed: 0, items: await listAccounts() };
  }

  const before = await listRecords();
  const nextAccounts = await saveTransformed((accounts) => accounts.filter((item) => !target.has(item.access_token)));
  accountSelector.reset(nextAccounts.length);

  return {
    removed: before.length - nextAccounts.length,
    items: nextAccounts.map(publicAccount),
  };
}

export async function removeToken(accessToken: string) {
  const result = await deleteAccounts([accessToken]);
  return result.removed > 0;
}

export async function updateAccount(accessToken: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null> {
  const normalizedToken = cleanToken(accessToken);
  let updated: AccountRecord | null = null;

  await saveTransformed((accounts) =>
    accounts.map((account) => {
      if (account.access_token !== normalizedToken) {
        return account;
      }
      updated = normalizeAccount({
        ...account,
        ...updates,
        access_token: normalizedToken,
      });
      return updated ?? account;
    }),
  );

  return updated;
}

export async function markImageResult(accessToken: string, success: boolean) {
  const current = await getAccount(accessToken);
  if (!current) {
    return null;
  }

  return updateAccount(accessToken, {
    ...current,
    last_used_at: new Date().toISOString(),
    success: success ? current.success + 1 : current.success,
    fail: success ? current.fail : current.fail + 1,
    quota: success ? Math.max(0, current.quota - 1) : current.quota,
    status: success
      ? current.quota - 1 <= 0
        ? "限流"
        : current.status === "限流"
          ? "正常"
          : current.status
      : current.status,
  });
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
