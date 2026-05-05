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

type AccountRefreshFailure = {
  message: string;
  status: "正常" | "限流" | "异常";
  quota?: number;
  reason:
    | "auth_invalid"
    | "account_restricted"
    | "rate_limited"
    | "conversation_init_failed"
    | "network_error"
    | "request_timeout"
    | "unknown";
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

function resolveRefreshFailure(error: unknown): AccountRefreshFailure {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  const normalized = cleanToken(message).toLowerCase();

  if (normalized.includes("/backend-api/me failed: http 401")) {
    return {
      message: "访问令牌失效，或账号授权已被撤销",
      status: "异常",
      quota: 0,
      reason: "auth_invalid",
    };
  }

  if (normalized.includes("/backend-api/me failed: http 403")) {
    return {
      message: "账号访问受限，当前无法读取账户信息",
      status: "异常",
      quota: 0,
      reason: "account_restricted",
    };
  }

  if (normalized.includes("/backend-api/me failed: http 429")) {
    return {
      message: "账号请求过于频繁，或上游已对该账号限流",
      status: "限流",
      quota: 0,
      reason: "rate_limited",
    };
  }

  if (normalized.includes("/backend-api/conversation/init failed: http 401")) {
    return {
      message: "会话初始化失败，当前授权已失效",
      status: "异常",
      quota: 0,
      reason: "auth_invalid",
    };
  }

  if (normalized.includes("/backend-api/conversation/init failed: http 403")) {
    return {
      message: "会话初始化被拒绝，账号可能命中风控或访问受限",
      status: "异常",
      quota: 0,
      reason: "conversation_init_failed",
    };
  }

  if (normalized.includes("/backend-api/conversation/init failed: http 429")) {
    return {
      message: "会话初始化被限流，请稍后重试",
      status: "限流",
      quota: 0,
      reason: "rate_limited",
    };
  }

  if (normalized.includes("/backend-api/conversation/init failed: http")) {
    return {
      message: "会话初始化失败，上游未正常返回可用会话",
      status: "异常",
      reason: "conversation_init_failed",
    };
  }

  if (normalized.includes("request timed out") || normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      message: "请求超时，未能在规定时间内完成账号状态刷新",
      status: "异常",
      reason: "request_timeout",
    };
  }

  if (normalized.includes("network error") || normalized.includes("fetch failed") || normalized.includes("econn") || normalized.includes("enotfound")) {
    return {
      message: "网络异常，无法连接上游服务",
      status: "异常",
      reason: "network_error",
    };
  }

  return {
    message,
    status: "异常",
    reason: "unknown",
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
      const result = await runtimeDependencies.updateAccount(accessToken, {
        ...info,
        refresh_error: null,
        refresh_error_reason: null,
      });
      logger.info("account-service", "账号刷新成功", {
        email: info.email,
        type: info.type,
        quota: info.quota,
        status: info.status,
      });
      return result;
    } catch (error) {
      const failure = resolveRefreshFailure(error);
      logger.warn("account-service", "账号刷新失败", {
        reason: failure.reason,
        message: failure.message,
        token: accessToken.slice(0, 16) + "...",
      });
      return runtimeDependencies.updateAccount(accessToken, {
        status: failure.status,
        ...(typeof failure.quota === "number" ? { quota: failure.quota } : {}),
        refresh_error: failure.message,
        refresh_error_reason: failure.reason,
      });
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
          refresh_error: null,
          refresh_error_reason: null,
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
      const failure = resolveRefreshFailure(item.reason);
      await runtimeDependencies.updateAccount(accessToken, {
        status: failure.status,
        ...(typeof failure.quota === "number" ? { quota: failure.quota } : {}),
        refresh_error: failure.message,
        refresh_error_reason: failure.reason,
      });
      errors.push({
        access_token: accessToken,
        error: failure.message,
        reason: failure.reason,
      });
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
