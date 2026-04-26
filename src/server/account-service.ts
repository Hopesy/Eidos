import { createHash } from "node:crypto";
import { addRequestLog } from "@/server/request-log-store";

import { getSavedConfig } from "@/server/config-store";
import type { ImageApiStyle, ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import {
  fetchRemoteAccountInfo,
  generateImageResult,
  generateImageResultWithApiService,
  generateImageResultWithAttachments,
  generateImageResultWithResponsesApiService,
  ImageGenerationError,
  isTokenInvalidError,
} from "@/server/providers/openai-client";
import { logger } from "@/server/logger";
import { persistImageResponseItems } from "@/server/image-file-store";
import { updateAccounts, readAccounts } from "@/server/store";
import type { AccountRecord, AccountRefreshError, AccountStatus, AccountType, PublicAccount } from "@/server/types";

let nextIndex = 0;

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
  if (!enabled || !apiKey) {
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

export async function refreshAccounts(accessTokens: string[]) {
  const normalizedTokens = dedupeTokens(accessTokens);
  if (normalizedTokens.length === 0) {
    return { refreshed: 0, errors: [] as AccountRefreshError[], items: await listAccounts() };
  }

  let refreshed = 0;
  const errors: AccountRefreshError[] = [];

  const settled = await Promise.allSettled(
    normalizedTokens.map(async (accessToken) => {
      const remoteInfo = await fetchAccountRemoteInfo(accessToken);
      const updated = await updateAccount(accessToken, remoteInfo);
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
  let lastAccountEmail: string | undefined;
  let lastAccountType: string | undefined;

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
    prompt: prompt.slice(0, 80),
  });

  let requestIndex = 1;
  while (data.length < count) {
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

      try {
        const account = await getAccount(requestToken);
        if (account) {
          lastAccountEmail = account.email ?? undefined;
          lastAccountType = account.type ?? undefined;
        }
        const result = await generateImageResult(requestToken, prompt, model, account, {
          size: imageSize,
          quality: imageQuality,
        }) as { created: number; data: Array<Record<string, unknown>> };
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
        logger.error("account-service", `第 ${requestIndex} 次请求：失败`, { token: tokenHint, error: message.slice(0, 200) });
        if (isTokenInvalidError(message)) {
          logger.warn("account-service", "Token 无效，自动移除", { token: tokenHint });
          await removeToken(requestToken);
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

  if (data.length < count && imageApiService) {
    const needed = count - data.length;
    logger.info("account-service", "本地账号不足，切换图像 API 服务补齐", {
      model,
      needed,
      endpoint: imageApiService.baseUrl,
    });
    try {
      const result = (imageApiService.apiStyle === "responses"
        ? await generateImageResultWithResponsesApiService(imageApiService, prompt, model, needed, {
          size: imageSize,
          quality: imageQuality,
        })
        : await generateImageResultWithApiService(imageApiService, prompt, model, needed, {
          size: imageSize,
          quality: imageQuality,
        })) as {
        created: number;
        data: Array<Record<string, unknown>>;
      };
      result.data = await persistImageResponseItems(result.data, {
        route,
        operation,
        model,
        prompt,
        accountEmail: "图像 API 服务",
        accountType: "api_service",
      }, { keepBase64: true });
      if (created === null) {
        created = Number(result.created || Math.floor(Date.now() / 1000));
      }
      if (Array.isArray(result.data)) {
        data.push(...result.data);
      }
      lastAccountEmail = "图像 API 服务";
      lastAccountType = "api_service";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.push(message);
      logger.error("account-service", "图像 API 服务补齐失败", {
        model,
        needed,
        error: message.slice(0, 200),
      });
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
    });
    throw new ImageGenerationError(errMsg);
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
  });
  return {
    created: created ?? Math.floor(Date.now() / 1000),
    data: data.slice(0, count),
  };
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
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const route = "edits";
  const operation = "edit";
  let lastAccountEmail: string | undefined;
  let lastAccountType: string | undefined;

  const requestToken = await getAvailableAccessToken();
  const account = await getAccount(requestToken);
  if (account) {
    lastAccountEmail = account.email ?? undefined;
    lastAccountType = account.type ?? undefined;
  }

  try {
    const result = await generateImageResultWithAttachments(requestToken, prompt, model, account, {
      images,
      mask,
      size: options.imageSize,
      quality: options.imageQuality,
    }) as { created: number; data: Array<Record<string, unknown>> };

    result.data = await persistImageResponseItems(result.data, {
      route,
      operation,
      model,
      prompt,
      accountEmail: account?.email ?? null,
      accountType: account?.type ?? null,
    }, { keepBase64: true });

    await markImageResult(requestToken, true);
    addRequestLog({
      startedAt,
      finishedAt: new Date().toISOString(),
      endpoint: "POST /v1/images/edits",
      operation,
      route,
      model,
      count: 1,
      success: true,
      durationMs: Date.now() - startTime,
      accountEmail: lastAccountEmail,
      accountType: lastAccountType,
    });
    return result;
  } catch (error) {
    await markImageResult(requestToken, false);
    const message = error instanceof Error ? error.message : String(error);
    addRequestLog({
      startedAt,
      finishedAt: new Date().toISOString(),
      endpoint: "POST /v1/images/edits",
      operation,
      route,
      model,
      count: 1,
      success: false,
      error: message.slice(0, 300),
      durationMs: Date.now() - startTime,
      accountEmail: lastAccountEmail,
      accountType: lastAccountType,
    });
    throw error;
  }
}

export async function upscaleWithPool(
  prompt: string,
  model: string,
  image: File,
  options: {
    scale?: number;
  } = {},
) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const route = "upscale";
  const operation = "upscale";
  const scale = options.scale ?? 2;
  let lastAccountEmail: string | undefined;
  let lastAccountType: string | undefined;

  const requestToken = await getAvailableAccessToken();
  const account = await getAccount(requestToken);
  if (account) {
    lastAccountEmail = account.email ?? undefined;
    lastAccountType = account.type ?? undefined;
  }

  try {
    const result = await generateImageResultWithAttachments(requestToken, prompt, model, account, {
      images: [image],
    }) as { created: number; data: Array<Record<string, unknown>> };

    result.data = await persistImageResponseItems(result.data, {
      route,
      operation,
      model,
      prompt,
      accountEmail: account?.email ?? null,
      accountType: account?.type ?? null,
    }, { keepBase64: true });

    await markImageResult(requestToken, true);

    addRequestLog({
      startedAt,
      finishedAt: new Date().toISOString(),
      endpoint: "POST /v1/images/upscale",
      operation,
      route,
      model,
      count: 1,
      success: true,
      durationMs: Date.now() - startTime,
      accountEmail: lastAccountEmail,
      accountType: lastAccountType,
    });
    logger.info("account-service", "图片放大完成", {
      model,
      scale,
      elapsedMs: Date.now() - startTime,
      accountEmail: lastAccountEmail ?? null,
    });
    return result;
  } catch (error) {
    await markImageResult(requestToken, false);
    const message = error instanceof Error ? error.message : String(error);
    addRequestLog({
      startedAt,
      finishedAt: new Date().toISOString(),
      endpoint: "POST /v1/images/upscale",
      operation,
      route,
      model,
      count: 1,
      success: false,
      error: message.slice(0, 300),
      durationMs: Date.now() - startTime,
      accountEmail: lastAccountEmail,
      accountType: lastAccountType,
    });
    throw error;
  }
}

export async function ensureAccountWatcherStarted() {
  // 定期自动刷新已禁用，账号状态由用户手动刷新
}


