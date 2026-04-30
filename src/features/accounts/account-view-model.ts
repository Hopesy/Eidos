import type {
  Account,
  AccountImportResponse,
  AccountStatus,
  AccountType,
  SyncStatus,
  SyncStatusResponse,
} from "@/lib/api";

export type AccountTypeFilter = AccountType | "all";
export type AccountStatusFilter = AccountStatus | "all";

export const accountTypeOptions: { label: string; value: AccountTypeFilter }[] = [
  { label: "全部类型", value: "all" },
  { label: "Free", value: "Free" },
  { label: "Plus", value: "Plus" },
  { label: "Team", value: "Team" },
  { label: "Pro", value: "Pro" },
];

export const accountStatusOptions: { label: string; value: AccountStatusFilter }[] = [
  { label: "全部状态", value: "all" },
  { label: "正常", value: "正常" },
  { label: "限流", value: "限流" },
  { label: "异常", value: "异常" },
  { label: "禁用", value: "禁用" },
];

const accountStatusSortOrder: Record<AccountStatus, number> = {
  正常: 0,
  限流: 1,
  异常: 2,
  禁用: 3,
};

export function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

export function formatQuota(value: number) {
  return String(Math.max(0, value));
}

export function formatRelativeTime(value?: string | null, now = Date.now()) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const diffMs = Math.max(0, date.getTime() - now);
  if (diffMs <= 0) {
    return "已到恢复时间";
  }

  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `剩余 ${days}d ${hours}h`;
}

export function formatQuotaSummary(accounts: Account[]) {
  return formatCompact(accounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

export function maskToken(token?: string) {
  if (!token) return "—";
  if (token.length <= 18) return token;
  return `${token.slice(0, 16)}...${token.slice(-8)}`;
}

export function normalizeAccounts(items: Account[]): Account[] {
  return items.map((item) => ({
    ...item,
    type:
      item.type === "Plus" || item.type === "Team" || item.type === "Pro" || item.type === "Free"
        ? item.type
        : "Free",
  }));
}

export function buildImportSummary(data: AccountImportResponse) {
  const imported = data.imported ?? 0;
  const duplicates = data.duplicates?.length ?? 0;
  const failed = data.failed?.length ?? 0;
  const refreshed = data.refreshed ?? 0;
  return `导入 ${imported} 个，刷新 ${refreshed} 个，重复 ${duplicates} 个，失败 ${failed} 个`;
}

export function extractImageGenLimit(account: Account) {
  const imageGen = account.limits_progress?.find((item) => item.feature_name === "image_gen");
  return {
    remaining: typeof imageGen?.remaining === "number" ? imageGen.remaining : null,
    resetAfter: imageGen?.reset_after || account.restoreAt || null,
  };
}

function toSortTime(value?: string | null) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function formatTableTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function filterAndSortAccounts(
  accounts: Account[],
  filters: {
    query: string;
    typeFilter: AccountTypeFilter;
    statusFilter: AccountStatusFilter;
  },
) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const filtered = accounts.filter((account) => {
    const searchMatched =
      normalizedQuery.length === 0 ||
      (account.email ?? "").toLowerCase().includes(normalizedQuery) ||
      (account.fileName ?? "").toLowerCase().includes(normalizedQuery) ||
      (account.note ?? "").toLowerCase().includes(normalizedQuery);
    const typeMatched = filters.typeFilter === "all" || account.type === filters.typeFilter;
    const statusMatched = filters.statusFilter === "all" || account.status === filters.statusFilter;
    return searchMatched && typeMatched && statusMatched;
  });

  return filtered.sort((a, b) => {
    const statusDelta = accountStatusSortOrder[a.status] - accountStatusSortOrder[b.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return toSortTime(b.updatedAt ?? b.lastUsedAt) - toSortTime(a.updatedAt ?? a.lastUsedAt);
  });
}

export function buildAccountsSummary(accounts: Account[]) {
  const total = accounts.length;
  const active = accounts.filter((item) => item.status === "正常").length;
  const limited = accounts.filter((item) => item.status === "限流").length;
  const abnormal = accounts.filter((item) => item.status === "异常").length;
  const disabled = accounts.filter((item) => item.status === "禁用").length;
  const quota = formatQuotaSummary(accounts);

  return { total, active, limited, abnormal, disabled, quota };
}

export function getSelectedTokens(accounts: Account[], selectedIds: string[]) {
  const selectedSet = new Set(selectedIds);
  return accounts.filter((item) => selectedSet.has(item.id)).map((item) => item.access_token);
}

export function getAbnormalTokens(accounts: Account[]) {
  return accounts.filter((item) => item.status === "异常").map((item) => item.access_token);
}

export function pruneSelectedIds(selectedIds: string[], accounts: Account[]) {
  const validIds = new Set(accounts.map((item) => item.id));
  return selectedIds.filter((id) => validIds.has(id));
}

export function normalizeSyncStatus(payload: SyncStatusResponse | null) {
  return {
    configured: payload?.configured ?? false,
    local: payload?.local ?? 0,
    remote: payload?.remote ?? 0,
    accounts: payload?.accounts ?? [],
    disabledMismatch: payload?.disabledMismatch ?? 0,
    lastRun: payload?.lastRun ?? null,
    summary: {
      synced: payload?.summary?.synced ?? 0,
      pending_upload: payload?.summary?.pending_upload ?? 0,
      remote_only: payload?.summary?.remote_only ?? 0,
      remote_deleted: payload?.summary?.remote_deleted ?? 0,
    } satisfies Record<SyncStatus, number>,
  };
}

export type AccountSummaryView = ReturnType<typeof buildAccountsSummary>;
export type AccountSyncView = ReturnType<typeof normalizeSyncStatus>;
