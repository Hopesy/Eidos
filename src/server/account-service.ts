import { createHash } from "node:crypto";
import { addRequestLog } from "@/server/request-log-store";

import { getSavedConfig } from "@/server/config-store";
import type { ImageApiStyle, ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import {
  editImageResultWithApiService,
  editImageResultWithResponsesApiService,
  fetchRemoteAccountInfo,
  generateImageResult,
  generateImageResultWithApiService,
  generateImageResultWithAttachments,
  getImageErrorMeta,
  generateImageResultWithResponsesApiService,
  ImageGenerationError,
  isTokenInvalidError,
  recoverImageResult,
} from "@/server/providers/openai-client";
import { logger } from "@/server/logger";
import { persistImageResponseItems } from "@/server/image-file-store";
import { updateAccounts, readAccounts } from "@/server/store";
import type { AccountRecord, AccountRefreshError, AccountStatus, AccountType, PublicAccount } from "@/server/types";

let nextIndex = 0;
const API_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 1500;

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

function normalizeAccountType(value: unknown): AccountType | null {
  const normalized = cleanToken(value).toLowerCase();
  const mapping: Record<string, AccountType> = {
    free: "Free",
    plus: "Plus",
    team: "Team",
    pro: "Pro",
    personal: "Plus",
    business: "Team",
    enterprise: "Team",
  };
  return mapping[normalized] ?? null;
}

export function getImageApiServiceConfig() {
  const savedConfig = getSavedConfig() as
    | {
      chatgpt?: {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        apiStyle?: ImageApiStyle;
        responsesModel?: string;
      };
    }
    | null;
  const enabled = Boolean(savedConfig?.chatgpt?.enabled);
  const baseUrl = cleanToken(savedConfig?.chatgpt?.baseUrl) || "https://api.openai.com/v1";
  const apiKey = cleanToken(savedConfig?.chatgpt?.apiKey);
  const apiStyle = (cleanToken(savedConfig?.chatgpt?.apiStyle) || "v1") as ImageApiStyle;
  const responsesModel = cleanToken(savedConfig?.chatgpt?.responsesModel) || "gpt-5.5";
  if (!enabled) {
    return null;
  }
  return {
    baseUrl,
    apiKey,
    apiStyle,
    responsesModel,
  };
}

function searchAccountType(value: unknown): AccountType | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const matched = searchAccountType(item);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries) {
      const matched = normalizeAccountType(item);
      if (matched && /(plan|type|subscription|workspace|tier)/i.test(key)) {
        return matched;
      }
    }
    for (const [, item] of entries) {
      const matched = searchAccountType(item);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  return normalizeAccountType(value);
}

function decodeAccessTokenPayload(accessToken: string) {
  const parts = cleanToken(accessToken).split(".");
  if (parts.length < 2) {
    return {} as Record<string, unknown>;
  }
  const payload = parts[1].padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), "=");
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function detectAccountType(accessToken: string, mePayload: Record<string, unknown>, initPayload: Record<string, unknown>): AccountType {
  const tokenPayload = decodeAccessTokenPayload(accessToken);
  const authPayload = tokenPayload["https://api.openai.com/auth"];
  if (authPayload && typeof authPayload === "object") {
    const matched = normalizeAccountType((authPayload as Record<string, unknown>).chatgpt_plan_type);
    if (matched) {
      return matched;
    }
  }

  return searchAccountType(mePayload) || searchAccountType(initPayload) || searchAccountType(tokenPayload) || "Free";
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

function extractQuotaAndRestoreAt(limitsProgress: Array<Record<string, unknown>>) {
  const imageGen = limitsProgress.find((item) => item.feature_name === "image_gen");
  return {
    quota: Math.max(0, Number(imageGen?.remaining ?? 0) || 0),
    restoreAt: cleanToken(imageGen?.reset_after) || null,
  };
}

function isImageAccountAvailable(account: AccountRecord | null) {
  return Boolean(account && account.status !== "禁用" && account.quota > 0);
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

function isRetryableApiError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "retry_download");
  }
  return isRetryableImageError(error);
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
  imageApiService: NonNullable<ReturnType<typeof getImageApiServiceConfig>>,
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

async function runApiGenerateTask(
  imageApiService: NonNullable<ReturnType<typeof getImageApiServiceConfig>>,
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
      }) as {
        created: number;
        data: Array<Record<string, unknown>>;
      };

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

async function runApiSingleTask<T extends { created: number; data: Array<Record<string, unknown>> }>(
  imageApiService: NonNullable<ReturnType<typeof getImageApiServiceConfig>>,
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
  if (nextAccounts.length > 0) {
    nextIndex %= nextAccounts.length;
  } else {
    nextIndex = 0;
  }

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
  const account = await getAccount(accessToken);
  if (!account) {
    throw new Error("account not found");
  }

  const { mePayload, initPayload } = await fetchRemoteAccountInfo(accessToken, account);
  const limitsProgress = Array.isArray(initPayload.limits_progress)
    ? (initPayload.limits_progress as Array<Record<string, unknown>>)
    : [];
  const { quota, restoreAt } = extractQuotaAndRestoreAt(limitsProgress);

  return {
    email: cleanToken(mePayload.email) || null,
    user_id: cleanToken(mePayload.id) || null,
    type: detectAccountType(accessToken, mePayload, initPayload),
    quota,
    limits_progress: limitsProgress,
    default_model_slug: cleanToken(initPayload.default_model_slug) || null,
    restore_at: restoreAt,
    status: quota === 0 ? "限流" : "正常",
  } satisfies Partial<AccountRecord>;
}

export async function refreshAccountState(accessToken: string): Promise<AccountRecord | null> {
  try {
    const info = await fetchAccountRemoteInfo(accessToken);
    const result = await updateAccount(accessToken, info);
    logger.info("account-service", "账号刷新成功", {
      email: info.email,
      type: info.type,
      quota: info.quota,
      status: info.status,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("/backend-api/me failed: HTTP 401")) {
      logger.warn("account-service", "账号 401 异常，标记禁用", { token: accessToken.slice(0, 16) + "..." });
      return updateAccount(accessToken, { status: "异常", quota: 0 });
    }
    logger.error("account-service", "账号刷新失败", { message, token: accessToken.slice(0, 16) + "..." });
    return null;
  }
}

export async function refreshAccounts(accessTokens: string[], options?: { markRefreshedAt?: boolean }) {
  const normalizedTokens = dedupeTokens(accessTokens);
  if (normalizedTokens.length === 0) {
    return { refreshed: 0, errors: [] as AccountRefreshError[], items: await listAccounts() };
  }

  const refreshedAt = options?.markRefreshedAt ? new Date().toISOString() : null;
  let refreshed = 0;
  const errors: AccountRefreshError[] = [];

  const settled = await Promise.allSettled(
    normalizedTokens.map(async (accessToken) => {
      const remoteInfo = await fetchAccountRemoteInfo(accessToken);
      const updated = await updateAccount(accessToken, {
        ...remoteInfo,
        ...(refreshedAt ? { last_refreshed_at: refreshedAt } : {}),
      });
      if (updated) {
        refreshed += 1;
      }
    }),
  );

  settled.forEach((item, index) => {
    if (item.status === "fulfilled") {
      return;
    }
    const accessToken = normalizedTokens[index];
    let message = item.reason instanceof Error ? item.reason.message : String(item.reason);
    if (message.includes("/backend-api/me failed: HTTP 401")) {
      void updateAccount(accessToken, { status: "异常", quota: 0 });
      message = "检测到封号";
    }
    errors.push({ access_token: accessToken, error: message });
  });

  return {
    refreshed,
    errors,
    items: await listAccounts(),
  };
}

export async function getAvailableAccessToken(excludedTokens?: Set<string>) {
  const accounts = await listRecords();
  // 过滤：未被禁用 + 未在排除集合中（quota=0 的新导入账号也允许参与，刷新后再判断实际余量）
  const candidates = accounts.filter(
    (item) => item.status !== "禁用" && !excludedTokens?.has(item.access_token),
  );
  if (candidates.length === 0) {
    throw new Error("暂无可用账号，请先在账号管理页面添加并启用账号");
  }

  // 优先使用已有 quota 的账号（避免对每个新账号都发起远端请求拖慢速度）
  const withQuota = candidates.filter((item) => item.quota > 0);
  const available = withQuota.length > 0 ? withQuota : candidates;

  while (available.length > 0) {
    const account = available[nextIndex % available.length];
    nextIndex += 1;
    const refreshed = await refreshAccountState(account.access_token);
    if (refreshed && refreshed.status !== "禁用" && refreshed.quota > 0) {
      return refreshed.access_token;
    }
    excludedTokens?.add(account.access_token);
    const nextAccounts = available.filter((item) => item.access_token !== account.access_token);
    available.splice(0, available.length, ...nextAccounts);
  }

  throw new Error("暂无可用账号，请先在账号管理页面添加并启用账号");
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
  const imageApiService = getImageApiServiceConfig();

  logger.info("account-service", "开始图片生成", {
    model,
    count,
    size: imageSize,
    quality: imageQuality,
  });

  if (imageApiService) {
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
        requestToken = await getAvailableAccessToken(attempted);
      } catch (noTokenErr) {
        const msg = noTokenErr instanceof Error ? noTokenErr.message : String(noTokenErr);
        lastErrors.push(msg);
        logger.warn("account-service", `第 ${requestIndex} 次请求：无可用 token`, { reason: msg });
        break;
      }

      const tokenHint = requestToken.slice(0, 16) + "...";
      logger.info("account-service", `第 ${requestIndex} 次请求：使用 token`, { token: tokenHint, model });
      const account = await getAccount(requestToken);

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
        await markImageResult(requestToken, true);
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
        await markImageResult(requestToken, false);
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
          await removeToken(requestToken);
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
      requestToken = await getAvailableAccessToken(attempted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      break;
    }

    const account = await getAccount(requestToken);
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

      await markImageResult(requestToken, true);
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
      await markImageResult(requestToken, false);
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
        await removeToken(requestToken);
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
  return runAttachmentTaskWithPool(
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
    scale?: number;
  } = {},
) {
  const operation = "upscale";
  const scale = options.scale ?? 2;
  return runAttachmentTaskWithPool(
    prompt,
    model,
    {
      images: [image],
    },
    {
      endpoint: "POST /v1/images/upscale",
      operation,
      count: 1,
      route: "upscale",
      successLogMessage: "图片放大完成",
      successLogData: { model, scale },
    },
  );
}

export async function upscaleWithApiService(
  prompt: string,
  model: string,
  image: File,
  options: {
    scale?: number;
  } = {},
) {
  const imageApiService = getImageApiServiceConfig();
  if (!imageApiService) {
    throw new Error("image api service is not enabled");
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  return runApiSingleTask(
    imageApiService,
    () => imageApiService.apiStyle === "responses"
      ? editImageResultWithResponsesApiService(imageApiService, {
        prompt,
        images: [image],
      })
      : editImageResultWithApiService(imageApiService, {
        prompt,
        model,
        images: [image],
      }),
    {
      endpoint: "POST /v1/images/upscale",
      route: "upscale",
      operation: "upscale",
      model,
      prompt,
      count: 1,
      startedAt,
      startedAtMs,
      successLogMessage: "图像 API 图片放大完成",
      successLogData: { model, scale: options.scale ?? 2 },
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

  const account = await getAccountById(params.sourceAccountId || "");
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
}
