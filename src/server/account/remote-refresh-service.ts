import { logger } from "@/server/logger";
import {
  fetchRemoteAccountInfo as fetchRemoteAccountInfoFromUpstream,
} from "@/server/providers/openai-client";
import { normalizeAccountType } from "@/server/account/type-policy";
import type { AccountRecord, AccountRefreshError, AccountType, PublicAccount } from "@/server/types";

export type AccountRemoteRefreshDependencies = {
  getAccount(accessToken: string): Promise<AccountRecord | null>;
  updateAccount(accessToken: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null>;
  listAccounts(): Promise<PublicAccount[]>;
  fetchRemoteAccountInfo?(
    accessToken: string,
    account: AccountRecord | null,
  ): Promise<{
    mePayload: Record<string, unknown>;
    initPayload: Record<string, unknown>;
  }>;
  now?(): string;
};

export type AccountRemoteRefreshService = {
  fetchAccountRemoteInfo(accessToken: string): Promise<Partial<AccountRecord>>;
  refreshAccountState(accessToken: string): Promise<AccountRecord | null>;
  refreshAccounts(
    accessTokens: string[],
    options?: { markRefreshedAt?: boolean },
  ): Promise<{ refreshed: number; errors: AccountRefreshError[]; items: PublicAccount[] }>;
};

const defaultDependencies = {
  fetchRemoteAccountInfo: fetchRemoteAccountInfoFromUpstream,
  now: () => new Date().toISOString(),
};

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

function extractQuotaAndRestoreAt(limitsProgress: Array<Record<string, unknown>>) {
  const imageGen = limitsProgress.find((item) => item.feature_name === "image_gen");
  return {
    quota: Math.max(0, Number(imageGen?.remaining ?? 0) || 0),
    restoreAt: cleanToken(imageGen?.reset_after) || null,
  };
}

export function createAccountRemoteRefreshService(
  dependencies: AccountRemoteRefreshDependencies,
): AccountRemoteRefreshService {
  const runtimeDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  async function fetchAccountRemoteInfo(accessToken: string) {
    const account = await runtimeDependencies.getAccount(accessToken);
    if (!account) {
      throw new Error("account not found");
    }

    const { mePayload, initPayload } = await runtimeDependencies.fetchRemoteAccountInfo(accessToken, account);
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

  async function refreshAccountState(accessToken: string): Promise<AccountRecord | null> {
    try {
      const info = await fetchAccountRemoteInfo(accessToken);
      const result = await runtimeDependencies.updateAccount(accessToken, info);
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
        return runtimeDependencies.updateAccount(accessToken, { status: "异常", quota: 0 });
      }
      logger.error("account-service", "账号刷新失败", { message, token: accessToken.slice(0, 16) + "..." });
      return null;
    }
  }

  async function refreshAccounts(accessTokens: string[], options?: { markRefreshedAt?: boolean }) {
    const normalizedTokens = dedupeTokens(accessTokens);
    if (normalizedTokens.length === 0) {
      return { refreshed: 0, errors: [] as AccountRefreshError[], items: await runtimeDependencies.listAccounts() };
    }

    const refreshedAt = options?.markRefreshedAt ? runtimeDependencies.now() : null;
    let refreshed = 0;
    const errors: AccountRefreshError[] = [];

    const settled = await Promise.allSettled(
      normalizedTokens.map(async (accessToken) => {
        const remoteInfo = await fetchAccountRemoteInfo(accessToken);
        const updated = await runtimeDependencies.updateAccount(accessToken, {
          ...remoteInfo,
          ...(refreshedAt ? { last_refreshed_at: refreshedAt } : {}),
        });
        if (updated) {
          refreshed += 1;
        }
      }),
    );

    for (const [index, item] of settled.entries()) {
      if (item.status === "fulfilled") {
        continue;
      }
      const accessToken = normalizedTokens[index];
      let message = item.reason instanceof Error ? item.reason.message : String(item.reason);
      if (message.includes("/backend-api/me failed: HTTP 401")) {
        await runtimeDependencies.updateAccount(accessToken, { status: "异常", quota: 0 });
        message = "检测到封号";
      }
      errors.push({ access_token: accessToken, error: message });
    }

    return {
      refreshed,
      errors,
      items: await runtimeDependencies.listAccounts(),
    };
  }

  return {
    fetchAccountRemoteInfo,
    refreshAccountState,
    refreshAccounts,
  };
}
