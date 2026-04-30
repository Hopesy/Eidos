import { logger } from "@/server/logger";
import {
  fetchRemoteAccountInfo as fetchRemoteAccountInfoFromUpstream,
} from "@/server/providers/openai-client";
import type { AccountRecord, AccountRefreshError, AccountType, PublicAccount } from "@/server/types";

export type AccountRemoteRefreshDependencies = {
  getAccount(accessToken: string): Promise<AccountRecord | null>;
  updateAccount(accessToken: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null>;
  listAccounts(): Promise<PublicAccount[]>;
};

export type AccountRemoteRefreshService = {
  fetchAccountRemoteInfo(accessToken: string): Promise<Partial<AccountRecord>>;
  refreshAccountState(accessToken: string): Promise<AccountRecord | null>;
  refreshAccounts(
    accessTokens: string[],
    options?: { markRefreshedAt?: boolean },
  ): Promise<{ refreshed: number; errors: AccountRefreshError[]; items: PublicAccount[] }>;
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

export function normalizeAccountType(value: unknown): AccountType | null {
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
  return {
    async fetchAccountRemoteInfo(accessToken: string) {
      const account = await dependencies.getAccount(accessToken);
      if (!account) {
        throw new Error("account not found");
      }

      const { mePayload, initPayload } = await fetchRemoteAccountInfoFromUpstream(accessToken, account);
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
    },

    async refreshAccountState(accessToken: string): Promise<AccountRecord | null> {
      try {
        const info = await this.fetchAccountRemoteInfo(accessToken);
        const result = await dependencies.updateAccount(accessToken, info);
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
          return dependencies.updateAccount(accessToken, { status: "异常", quota: 0 });
        }
        logger.error("account-service", "账号刷新失败", { message, token: accessToken.slice(0, 16) + "..." });
        return null;
      }
    },

    async refreshAccounts(accessTokens: string[], options?: { markRefreshedAt?: boolean }) {
      const normalizedTokens = dedupeTokens(accessTokens);
      if (normalizedTokens.length === 0) {
        return { refreshed: 0, errors: [] as AccountRefreshError[], items: await dependencies.listAccounts() };
      }

      const refreshedAt = options?.markRefreshedAt ? new Date().toISOString() : null;
      let refreshed = 0;
      const errors: AccountRefreshError[] = [];

      const settled = await Promise.allSettled(
        normalizedTokens.map(async (accessToken) => {
          const remoteInfo = await this.fetchAccountRemoteInfo(accessToken);
          const updated = await dependencies.updateAccount(accessToken, {
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
          void dependencies.updateAccount(accessToken, { status: "异常", quota: 0 });
          message = "检测到封号";
        }
        errors.push({ access_token: accessToken, error: message });
      });

      return {
        refreshed,
        errors,
        items: await dependencies.listAccounts(),
      };
    },
  };
}
