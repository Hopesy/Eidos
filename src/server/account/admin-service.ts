import { createAccountId, resolveAccountId } from "@/server/account-id";
import { normalizeAccountType } from "@/server/account/type-policy";
import { updateAccounts, readAccounts } from "@/server/repositories/account";
import type { AccountRecord, AccountStatus, PublicAccount } from "@/server/types";

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
    id: cleanToken(input.id) || createAccountId(accessToken),
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
    id: resolveAccountId(account),
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

export type AccountAdminService = ReturnType<typeof createAccountAdminService>;

export type AccountAdminStoreDependencies = {
  readAccounts(): Promise<AccountRecord[]>;
  updateAccounts<T>(updater: (accounts: AccountRecord[]) => Promise<T> | T): Promise<T>;
};

const defaultDependencies: AccountAdminStoreDependencies = {
  readAccounts,
  updateAccounts,
};

export function createAccountAdminService(dependencies: AccountAdminStoreDependencies = defaultDependencies) {
  async function listRecords() {
    const raw = await dependencies.readAccounts();
    return raw
      .map((item) => normalizeAccount(item as Record<string, unknown>))
      .filter((item): item is AccountRecord => Boolean(item));
  }

  async function saveTransformed(
    updater: (accounts: AccountRecord[]) => Promise<AccountRecord[]> | AccountRecord[],
  ) {
    return dependencies.updateAccounts(async (accounts) => {
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
    return (await listRecords()).find((item) => resolveAccountId(item) === normalized) ?? null;
  }

  async function listAccounts() {
    return (await listRecords()).map(publicAccount);
  }

  async function listTokens() {
    return (await listRecords()).map((item) => item.access_token);
  }

  async function listLimitedTokens() {
    return (await listRecords())
      .filter((item) => item.status === "限流")
      .map((item) => item.access_token);
  }

  async function addAccounts(tokens: string[]) {
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

  async function deleteAccounts(tokens: string[]) {
    const target = new Set(dedupeTokens(tokens));
    if (target.size === 0) {
      return { removed: 0, items: await listAccounts() };
    }

    const before = await listRecords();
    const nextAccounts = await saveTransformed((accounts) => accounts.filter((item) => !target.has(item.access_token)));

    return {
      removed: before.length - nextAccounts.length,
      items: nextAccounts.map(publicAccount),
    };
  }

  async function updateAccount(accessToken: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null> {
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

  async function markImageResult(accessToken: string, success: boolean) {
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

  return {
    listRecords,
    getAccount,
    getAccountById,
    listAccounts,
    listTokens,
    listLimitedTokens,
    addAccounts,
    deleteAccounts,
    updateAccount,
    markImageResult,
  };
}
