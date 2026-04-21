import { createHash } from "node:crypto";

import { fetchRemoteAccountInfo, generateImageResult, ImageGenerationError, isTokenInvalidError } from "@/server/providers/openai-client";
import { getRuntimeConfig } from "@/server/config";
import { updateAccounts, readAccounts } from "@/server/store";
import type { AccountRecord, AccountRefreshError, AccountStatus, AccountType, PublicAccount } from "@/server/types";

let nextIndex = 0;
let watcherStarted = false;

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
    return await updateAccount(accessToken, info);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("/backend-api/me failed: HTTP 401")) {
      return updateAccount(accessToken, { status: "异常", quota: 0 });
    }
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
  const available = accounts.filter((item) => isImageAccountAvailable(item) && !excludedTokens?.has(item.access_token));
  if (available.length === 0) {
    throw new Error("No available tokens found in data/accounts.json");
  }

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

  throw new Error("No available tokens found in data/accounts.json");
}

export async function generateWithPool(prompt: string, model: string, count: number) {
  let created: number | null = null;
  const data: Array<Record<string, unknown>> = [];

  for (let index = 1; index <= count; index += 1) {
    const attempted = new Set<string>();
    while (true) {
      let requestToken = "";
      try {
        requestToken = await getAvailableAccessToken(attempted);
      } catch {
        break;
      }

      try {
        const account = await getAccount(requestToken);
        const result = await generateImageResult(requestToken, prompt, model, account);
        await markImageResult(requestToken, true);
        if (created === null) {
          created = Number(result.created || Math.floor(Date.now() / 1000));
        }
        if (Array.isArray(result.data)) {
          data.push(...result.data);
        }
        break;
      } catch (error) {
        await markImageResult(requestToken, false);
        const message = error instanceof Error ? error.message : String(error);
        if (isTokenInvalidError(message)) {
          await removeToken(requestToken);
          attempted.add(requestToken);
          continue;
        }
        if (error instanceof ImageGenerationError) {
          break;
        }
        throw error;
      }
    }
  }

  if (data.length === 0) {
    throw new ImageGenerationError("image generation failed");
  }

  return {
    created: created ?? Math.floor(Date.now() / 1000),
    data,
  };
}

export async function ensureAccountWatcherStarted() {
  if (watcherStarted || process.env.NODE_ENV === "test") {
    return;
  }

  watcherStarted = true;
  const config = await getRuntimeConfig();
  setInterval(async () => {
    const limitedTokens = await listLimitedTokens();
    if (limitedTokens.length > 0) {
      await refreshAccounts(limitedTokens);
    }
  }, config.refreshAccountIntervalMinute * 60 * 1000).unref?.();
}
