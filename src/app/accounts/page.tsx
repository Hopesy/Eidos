"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleOff,
  Copy,
  FileUp,
  LoaderCircle,
  Pencil,
  RefreshCcw,
  RefreshCw,
  Search,
  Shield,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteAccounts,
  fetchAccounts,
  fetchSyncStatus,
  importAccountFiles,
  refreshAccounts,
  runSync,
  updateAccount,
  type Account,
  type AccountImportResponse,
  type AccountStatus,
  type AccountType,
  type SyncAccount,
  type SyncStatus,
  type SyncStatusResponse,
} from "@/lib/api";
import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";
import { cn } from "@/lib/utils";
import { getCachedAccountsView, setCachedAccountsView } from "@/store/accounts-view-cache";
import { getCachedSyncStatus, setCachedSyncStatus } from "@/store/sync-status-cache";

const accountTypeOptions: { label: string; value: AccountType | "all" }[] = [
  { label: "全部类型", value: "all" },
  { label: "Free", value: "Free" },
  { label: "Plus", value: "Plus" },
  { label: "Team", value: "Team" },
  { label: "Pro", value: "Pro" },
];

const accountStatusOptions: { label: string; value: AccountStatus | "all" }[] = [
  { label: "全部状态", value: "all" },
  { label: "正常", value: "正常" },
  { label: "限流", value: "限流" },
  { label: "异常", value: "异常" },
  { label: "禁用", value: "禁用" },
];

const statusMeta: Record<
  AccountStatus,
  {
    icon: typeof CheckCircle2;
    badge: ComponentProps<typeof Badge>["variant"];
  }
> = {
  正常: { icon: CheckCircle2, badge: "success" },
  限流: { icon: CircleAlert, badge: "warning" },
  异常: { icon: CircleOff, badge: "danger" },
  禁用: { icon: Ban, badge: "secondary" },
};

const syncMeta: Record<
  SyncStatus,
  {
    label: string;
    badge: ComponentProps<typeof Badge>["variant"];
  }
> = {
  synced: { label: "已同步", badge: "success" },
  pending_upload: { label: "待上传", badge: "warning" },
  remote_only: { label: "远端独有", badge: "info" },
  remote_deleted: { label: "远端已删", badge: "danger" },
};

function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function formatQuota(value: number) {
  return String(Math.max(0, value));
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const diffMs = Math.max(0, date.getTime() - Date.now());
  if (diffMs <= 0) {
    return "已到恢复时间";
  }

  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `剩余 ${days}d ${hours}h`;
}

function formatQuotaSummary(accounts: Account[]) {
  return formatCompact(accounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

function maskToken(token?: string) {
  if (!token) return "—";
  if (token.length <= 18) return token;
  return `${token.slice(0, 16)}...${token.slice(-8)}`;
}

function normalizeAccounts(items: Account[]): Account[] {
  return items.map((item) => ({
    ...item,
    type:
      item.type === "Plus" || item.type === "Team" || item.type === "Pro" || item.type === "Free"
        ? item.type
        : "Free",
  }));
}

function buildImportSummary(data: AccountImportResponse) {
  const imported = data.imported ?? 0;
  const duplicates = data.duplicates?.length ?? 0;
  const failed = data.failed?.length ?? 0;
  const refreshed = data.refreshed ?? 0;
  return `导入 ${imported} 个，刷新 ${refreshed} 个，重复 ${duplicates} 个，失败 ${failed} 个`;
}

function extractImageGenLimit(account: Account) {
  const imageGen = account.limits_progress?.find((item) => item.feature_name === "image_gen");
  return {
    remaining: typeof imageGen?.remaining === "number" ? imageGen.remaining : null,
    resetAfter: imageGen?.reset_after || account.restoreAt || null,
  };
}

const accountStatusSortOrder: Record<AccountStatus, number> = {
  正常: 0,
  限流: 1,
  异常: 2,
  禁用: 3,
};

function toSortTime(value?: string | null) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatTableTime(value?: string | null) {
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

function normalizeSyncStatus(payload: SyncStatusResponse | null) {
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

export default function AccountsPage() {
  const router = useRouter();
  const cachedAccountsView = getCachedAccountsView();
  const didLoadRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<Account[]>(() => cachedAccountsView?.items ?? []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editType, setEditType] = useState<AccountType>("Free");
  const [editStatus, setEditStatus] = useState<AccountStatus>("正常");
  const [editQuota, setEditQuota] = useState("0");
  const [isLoading, setIsLoading] = useState(() => !cachedAccountsView);
  const [refreshingAction, setRefreshingAction] = useState<"all" | "selected" | null>(null);
  const [refreshingRowToken, setRefreshingRowToken] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [isSyncLoading, setIsSyncLoading] = useState(true);
  const [syncRunningDirection, setSyncRunningDirection] = useState<"pull" | "push" | "both" | null>(null);

  const loadAccounts = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const data = await fetchAccounts();
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载账户失败";
      toast.error(message);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const loadSync = async ({
    silent = false,
    force = false,
    revalidate = false,
    suppressError = false,
  }: {
    silent?: boolean;
    force?: boolean;
    revalidate?: boolean;
    suppressError?: boolean;
  } = {}) => {
    const cachedStatus = getCachedSyncStatus();
    if (!silent && !force && cachedStatus) {
      setSyncStatus(cachedStatus);
      setIsSyncLoading(false);
      if (revalidate) {
        void loadSync({ silent: true, force: true, suppressError: true });
      }
      return;
    }

    if (!silent) {
      setIsSyncLoading(true);
    }
    try {
      const data = await fetchSyncStatus();
      setCachedSyncStatus(data);
      setSyncStatus(data);
    } catch (error) {
      if (!suppressError) {
        const message = error instanceof Error ? error.message : "读取同步状态失败";
        toast.error(message);
      }
    } finally {
      if (!silent) {
        setIsSyncLoading(false);
      }
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void Promise.all([loadAccounts(Boolean(cachedAccountsView)), loadSync({ revalidate: true })]);
  }, []);

  useEffect(() => {
    const handleCredentialsRefreshed = () => {
      void loadAccounts(true);
    };

    window.addEventListener(APP_CREDENTIALS_REFRESHED_EVENT, handleCredentialsRefreshed);
    return () => {
      window.removeEventListener(APP_CREDENTIALS_REFRESHED_EVENT, handleCredentialsRefreshed);
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    setCachedAccountsView({
      items: accounts,
    });
  }, [accounts, isLoading]);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = accounts.filter((account) => {
      const searchMatched =
        normalizedQuery.length === 0 ||
        (account.email ?? "").toLowerCase().includes(normalizedQuery) ||
        (account.fileName ?? "").toLowerCase().includes(normalizedQuery) ||
        (account.note ?? "").toLowerCase().includes(normalizedQuery);
      const typeMatched = typeFilter === "all" || account.type === typeFilter;
      const statusMatched = statusFilter === "all" || account.status === statusFilter;
      return searchMatched && typeMatched && statusMatched;
    });

    return filtered.sort((a, b) => {
      const statusDelta = accountStatusSortOrder[a.status] - accountStatusSortOrder[b.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return toSortTime(b.updatedAt ?? b.lastUsedAt) - toSortTime(a.updatedAt ?? a.lastUsedAt);
    });
  }, [accounts, query, statusFilter, typeFilter]);

  const currentRows = filteredAccounts;
  const allCurrentSelected = currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row.id));

  const summary = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((item) => item.status === "正常").length;
    const limited = accounts.filter((item) => item.status === "限流").length;
    const abnormal = accounts.filter((item) => item.status === "异常").length;
    const disabled = accounts.filter((item) => item.status === "禁用").length;
    const quota = formatQuotaSummary(accounts);

    return { total, active, limited, abnormal, disabled, quota };
  }, [accounts]);

  const selectedTokens = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return accounts.filter((item) => selectedSet.has(item.id)).map((item) => item.access_token);
  }, [accounts, selectedIds]);

  const abnormalTokens = useMemo(() => {
    return accounts.filter((item) => item.status === "异常").map((item) => item.access_token);
  }, [accounts]);

  const syncView = useMemo(() => normalizeSyncStatus(syncStatus), [syncStatus]);

  const syncMap = useMemo(() => {
    return syncView.accounts.reduce<Record<string, SyncAccount>>((acc, item) => {
      acc[item.name] = item;
      return acc;
    }, {});
  }, [syncView.accounts]);

  const handleImportFiles = async (files: FileList | null) => {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0) {
      return;
    }

    setIsImporting(true);
    try {
      const data = await importAccountFiles(normalizedFiles);
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
      await loadSync({ silent: true, force: true });

      const failedMessage = data.failed?.[0]?.error;
      if ((data.failed?.length ?? 0) > 0) {
        toast.error(`${buildImportSummary(data)}${failedMessage ? `，首个错误：${failedMessage}` : ""}`);
      } else if ((data.duplicates?.length ?? 0) > 0) {
        toast.success(`${buildImportSummary(data)}。重复文件已跳过`);
      } else {
        toast.success(buildImportSummary(data));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入认证文件失败";
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteTokens = async (tokens: string[]) => {
    if (tokens.length === 0) {
      toast.error("请先选择要删除的账户");
      return;
    }

    setIsDeleting(true);
    try {
      const data = await deleteAccounts(tokens);
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
      await loadSync({ silent: true, force: true });
      const removed = data.removed ?? 0;
      if (syncView.configured) {
        toast.success(`本地已删除 ${removed} 个账户；若这些账号已同步到 CPA 远端，仍需在远端管理端删除，否则后续执行 pull / both 可能重新出现。`);
      } else {
        toast.success(`本地已删除 ${removed} 个账户`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除账户失败";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const isAnyRefreshRunning = refreshingAction !== null || refreshingRowToken !== null;

  const handleRefreshSelectedAccounts = async (
    accessTokens: string[],
    source: "all" | "selected" | "row" = "selected",
    rowToken?: string,
  ) => {
    if (accessTokens.length === 0) {
      toast.error("没有需要刷新的账户");
      return;
    }

    if (source === "row") {
      setRefreshingRowToken(rowToken ?? accessTokens[0] ?? null);
    } else {
      setRefreshingAction(source);
    }

    try {
      const data = await refreshAccounts(accessTokens);
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
      await loadSync({ silent: true, force: true });
      if (data.errors.length > 0) {
        const firstError = data.errors[0]?.error;
        toast.error(
          `刷新成功 ${data.refreshed} 个，失败 ${data.errors.length} 个${firstError ? `，首个错误：${firstError}` : ""}`,
        );
      } else {
        toast.success(`刷新成功 ${data.refreshed} 个账户`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新账户失败";
      toast.error(message);
    } finally {
      if (source === "row") {
        setRefreshingRowToken(null);
      } else {
        setRefreshingAction(null);
      }
    }
  };

  const handleRefreshAllLocalCredentials = async () => {
    await handleRefreshSelectedAccounts(
      accounts.map((item) => item.access_token),
      "all",
    );
  };

  const handleRunSync = async (direction: "pull" | "push" | "both") => {
    if (!syncView.configured) {
      toast.info("CPA 同步未配置", {
        description: "如需使用 CPA pull / push / both，请先前往配置页填写并保存。",
        action: {
          label: "前往配置",
          onClick: () => router.push("/settings"),
        },
      });
      return;
    }

    setSyncRunningDirection(direction);
    try {
      const result = await runSync(direction);
      await loadSync({ silent: true, force: true });

      if (!result.ok && result.error) {
        toast.error(result.error);
        return;
      }
      if (direction === "both") {
        toast.success(
          `CPA 同步完成：拉取 ${result.downloaded} 个，推送 ${result.uploaded} 个，状态对齐 ${result.disabled_aligned} 个`,
        );
      } else if (direction === "pull") {
        toast.success(`从 CPA 同步完成：拉取 ${result.downloaded} 个账号，状态对齐 ${result.disabled_aligned}`);
      } else {
        toast.success(`同步至 CPA 完成：推送 ${result.uploaded} 个账号，状态对齐 ${result.disabled_aligned}`);
      }
      await loadAccounts(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行同步失败";
      toast.error(message);
    } finally {
      setSyncRunningDirection(null);
    }
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setEditType(account.type);
    setEditStatus(account.status);
    setEditQuota(String(account.quota));
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) {
      return;
    }

    setIsUpdating(true);
    try {
      const data = await updateAccount(editingAccount.access_token, {
        type: editType,
        status: editStatus,
        quota: Number(editQuota || 0),
      });
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
      setEditingAccount(null);
      toast.success("账号信息已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新账号失败";
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentRows.map((item) => item.id)])));
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => !currentRows.some((row) => row.id === id)));
  };

  return (
    <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-[30px] border border-stone-200 bg-[#fcfcfb] px-4 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-5 sm:py-6 lg:px-6 lg:py-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm" />
          <div className="flex-1 -translate-y-[10px]">
            <h1 className="text-[28px] font-bold tracking-tight text-stone-950">号池管理</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-500">管理账号池与同步配置</p>
          </div>
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleImportFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => (!open ? setEditingAccount(null) : null)}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑账户</DialogTitle>
            <DialogDescription className="text-sm leading-6">手动修改账号状态、类型和额度。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">状态</label>
              <Select value={editStatus} onValueChange={(value) => setEditStatus(value as AccountStatus)}>
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountStatusOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">类型</label>
              <Select value={editType} onValueChange={(value) => setEditType(value as AccountType)}>
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountTypeOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">额度</label>
              <Input
                value={editQuota}
                onChange={(event) => setEditQuota(event.target.value)}
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setEditingAccount(null)}
              disabled={isUpdating}
            >
              取消
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleUpdateAccount()}
              disabled={isUpdating}
            >
              {isUpdating ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="space-y-1.5">
        <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="space-y-3 p-4">
            {/* 账号统计 + 标题 + 操作按钮 */}
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">CPA 同步</h2>
                  <p className="text-sm text-stone-500">查看本地账号与 CPA 远端状态，并执行双向同步。</p>
                </div>
                <div className="flex flex-wrap items-stretch gap-2">
                  {([
                    { label: "账户总数", value: summary.total, color: "text-stone-900", ring: "border-stone-200" },
                    { label: "正常", value: summary.active, color: "text-emerald-600", ring: "border-emerald-100" },
                    { label: "限流", value: summary.limited, color: "text-amber-500", ring: "border-amber-100" },
                    { label: "异常", value: summary.abnormal, color: "text-red-400", ring: "border-red-100/60" },
                    { label: "禁用", value: summary.disabled, color: "text-stone-400", ring: "border-stone-200" },
                  ] as const).map(({ label, value, color, ring }) => (
                    <div
                      key={label}
                      className={cn(
                        "min-w-[88px] rounded-2xl border bg-stone-50/80 px-3 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.04)]",
                        ring,
                      )}
                    >
                      <div className="text-[11px] font-medium leading-none text-stone-400">{label}</div>
                      <div className={cn("mt-2 text-lg font-semibold tabular-nums leading-none", color)}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void handleRefreshAllLocalCredentials()}
                  disabled={accounts.length === 0 || isAnyRefreshRunning || syncRunningDirection !== null}
                >
                  <RefreshCw className={cn("size-4", refreshingAction === "all" ? "animate-spin" : "")} />
                  刷新本地凭证
                </Button>
                <Button
                  className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
                  onClick={() => void handleRunSync("both")}
                  disabled={isSyncLoading || syncRunningDirection !== null}
                >
                  {syncRunningDirection !== null ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-4" />
                  )}
                  {syncRunningDirection !== null ? "同步中..." : "同步 CPA"}
                </Button>
              </div>
            </div>

            {isSyncLoading ? null : !syncView.configured ? null : (
              <>
                <div className="grid gap-3 md:grid-cols-5">
                  {([
                    ["本地", syncView.local],
                    ["远端", syncView.remote],
                    ["待上传", syncView.summary.pending_upload],
                    ["远端独有", syncView.summary.remote_only],
                    ["远端已删", syncView.summary.remote_deleted],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4">
                      <div className="text-xs font-medium text-stone-400">{label}</div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {syncView.disabledMismatch > 0 ? (
                    <Badge variant="warning" className="rounded-lg px-3 py-1">
                      状态不一致 {syncView.disabledMismatch}
                    </Badge>
                  ) : null}
                  {syncView.lastRun ? (
                    <Badge variant={syncView.lastRun.ok ? "success" : "danger"} className="rounded-lg px-3 py-1">
                      最近一次同步：{new Date(syncView.lastRun.finished_at).toLocaleString("zh-CN")} · {syncView.lastRun.direction || "both"}
                    </Badge>
                  ) : null}
                </div>

                {syncView.lastRun ? (
                  <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4">
                    <div className="mb-2 text-sm font-medium text-stone-700">最近一次同步结果</div>
                    <div className="grid gap-3 md:grid-cols-4">
                      {[
                        ["拉取", syncView.lastRun.downloaded],
                        ["推送", syncView.lastRun.uploaded],
                        ["状态对齐", syncView.lastRun.disabled_aligned],
                        ["失败", (syncView.lastRun.download_failed || 0) + (syncView.lastRun.upload_failed || 0) + (syncView.lastRun.disabled_align_failed || 0)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-2xl border border-stone-100 bg-white px-4 py-3">
                          <div className="text-xs font-medium text-stone-400">{label}</div>
                          <div className="mt-2 text-lg font-semibold tracking-tight text-stone-900">{value}</div>
                        </div>
                      ))}
                    </div>
                    {syncView.lastRun.error ? (
                      <div className="mt-3 text-sm text-rose-600">{syncView.lastRun.error}</div>
                    ) : null}
                  </div>
                ) : null}

                {syncView.accounts.length > 0 ? (
                  <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4">
                    <div className="mb-3 text-sm font-medium text-stone-700">待处理文件</div>
                    <div className="flex flex-wrap gap-2">
                      {syncView.accounts
                        .filter((item) => item.status !== "synced")
                        .slice(0, 18)
                        .map((item) => (
                          <Badge key={item.name} variant={syncMeta[item.status].badge} className="rounded-lg px-3 py-1">
                            {syncMeta[item.status].label} · {item.name}
                          </Badge>
                        ))}
                      {syncView.accounts.filter((item) => item.status !== "synced").length === 0 ? (
                        <Badge variant="success" className="rounded-lg px-3 py-1">
                          当前没有待同步文件
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-3.5 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">账户列表</h2>
            <Badge variant="secondary" className="rounded-lg bg-stone-200 px-2 py-0.5 text-stone-700">
              {filteredAccounts.length}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="搜索邮箱 / 文件名 / 备注"
                className="h-10 rounded-xl border-stone-200 bg-white/85 pl-10"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value as AccountType | "all");
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as AccountStatus | "all");
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              导入认证文件
            </Button>
          </div>
        </div>

        {isLoading && accounts.length === 0 ? (
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-stone-700">正在加载账户</p>
                <p className="text-sm text-stone-500">从后端读取本地 auth 文件和运行状态。</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card
          className={cn(
            "overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm",
            isLoading && accounts.length === 0 ? "hidden" : "",
          )}
        >
          <CardContent className="space-y-0 p-0">
            <div className="flex flex-col gap-3 border-b border-stone-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100"
                  onClick={() => void handleRefreshSelectedAccounts(selectedTokens, "selected")}
                  disabled={selectedTokens.length === 0 || isAnyRefreshRunning}
                >
                  {refreshingAction === "selected" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  刷新选中账号信息
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                  onClick={() => void handleDeleteTokens(abnormalTokens)}
                  disabled={abnormalTokens.length === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  移除异常账号
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                  onClick={() => void handleDeleteTokens(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  删除本地所选
                </Button>
                {selectedIds.length > 0 ? (
                  <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                    已选择 {selectedIds.length} 项
                  </span>
                ) : null}
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-375px)]">
              <table className="w-full min-w-[1240px] text-left">
                <thead className="border-b border-stone-100/80 bg-stone-50/60">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center">
                      <Checkbox checked={allCurrentSelected} onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))} />
                    </th>
                    <th className="w-72 px-3 py-2 text-left text-[11px] font-medium text-stone-400 whitespace-nowrap">账号 / Token</th>
                    <th className="w-24 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">状态</th>
                    <th className="w-24 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">类型</th>
                    <th className="w-36 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">图片额度</th>
                    <th className="w-36 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">刷新时间</th>
                    <th className="w-40 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">图片重置</th>
                    <th className="w-28 px-3 py-2 text-center text-[11px] font-medium text-stone-400 whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((account) => {
                    const status = statusMeta[account.status];
                    const StatusIcon = status.icon;
                    const imageGenLimit = extractImageGenLimit(account);
                    const imageGenRemaining = imageGenLimit.remaining;
                    const imageGenRestore = formatRelativeTime(imageGenLimit.resetAfter);

                    return (
                      <tr
                        key={account.id}
                        className="group border-b border-stone-100/80 text-sm transition-colors hover:bg-stone-50/60"
                      >
                        {/* 复选框 */}
                        <td className="px-3 py-1.5 text-center">
                          <Checkbox
                            checked={selectedIds.includes(account.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) =>
                                checked ? Array.from(new Set([...prev, account.id])) : prev.filter((item) => item !== account.id),
                              );
                            }}
                          />
                        </td>

                        {/* Token + Email */}
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[13px] font-semibold tracking-tight text-stone-800">
                              {maskToken(account.access_token)}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 text-stone-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-600"
                              onClick={() => {
                                void navigator.clipboard.writeText(account.access_token);
                                toast.success("token 已复制");
                              }}
                            >
                              <Copy className="size-3.5" />
                            </button>
                          </div>
                          <div className="mt-0.5 flex flex-col gap-px">
                            {account.email ? (
                              <span className="truncate text-[11px] leading-4 text-stone-500" title={account.email}>
                                {account.email}
                              </span>
                            ) : null}
                            {account.note ? (
                              <span className="truncate text-[11px] leading-4 text-stone-400" title={account.note}>
                                {account.note}
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* 状态 */}
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                              account.status === "正常" && "bg-emerald-50 text-emerald-700",
                              account.status === "限流" && "bg-amber-50 text-amber-700",
                              account.status === "异常" && "bg-red-50/60 text-red-400",
                              account.status === "禁用" && "bg-stone-100 text-stone-400",
                            )}
                          >
                            <StatusIcon className="size-3" />
                            {account.status}
                          </span>
                        </td>

                        {/* 类型 */}
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                            {account.type}
                          </span>
                        </td>

                        {/* 图片额度 */}
                        <td className="px-3 py-1.5 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="text-sm font-semibold tabular-nums text-stone-800">
                              {imageGenRemaining == null ? "—" : formatQuota(imageGenRemaining)}
                            </span>
                            <span className="text-[11px] text-stone-400">/ {formatQuota(account.quota)}</span>
                          </div>
                        </td>

                        {/* 刷新时间 */}
                        <td className="px-3 py-1.5 text-center whitespace-nowrap">
                          <span className="font-mono tabular-nums text-xs text-stone-500">
                            {formatTableTime(account.lastRefreshedAt)}
                          </span>
                        </td>

                        {/* 图片重置 */}
                        <td className="px-3 py-1.5 text-center text-xs text-stone-500 whitespace-nowrap">
                          <span className="font-medium text-stone-700">{imageGenRestore}</span>
                        </td>

                        {/* 操作 */}
                        <td className="px-3 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5 text-stone-400">
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => openEditDialog(account)}
                              disabled={isUpdating}
                              title="编辑"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-sky-50 hover:text-sky-500"
                              onClick={() => void handleRefreshSelectedAccounts([account.access_token], "row", account.access_token)}
                              disabled={isAnyRefreshRunning}
                              title="刷新状态"
                            >
                              {refreshingRowToken === account.access_token ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-rose-50 hover:text-rose-500"
                              onClick={() => void handleDeleteTokens([account.access_token])}
                              disabled={isDeleting}
                              title="删除本地账户"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!isLoading && currentRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                  <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                    <Search className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-stone-700">没有匹配的账户</p>
                    <p className="text-sm text-stone-500">调整筛选条件或搜索关键字后重试。</p>
                  </div>
                </div>
              ) : null}
            </div>

          </CardContent>
        </Card>
      </section>
    </div>
  );
}
