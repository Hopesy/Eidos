"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";
import {
  deleteAccounts,
  fetchAccounts,
  fetchSyncStatus,
  importAccountFiles,
  refreshAccounts,
  runSync,
  updateAccount,
  type Account,
  type AccountStatus,
  type AccountType,
  type SyncStatusResponse,
} from "@/lib/api";

import {
  buildAccountsSummary,
  buildImportSummary,
  filterAndSortAccounts,
  getAbnormalTokens,
  getSelectedTokens,
  normalizeAccounts,
  normalizeSyncStatus,
  pruneSelectedIds,
  type AccountStatusFilter,
  type AccountTypeFilter,
} from "./account-view-model";

type UseAccountsPageOptions = {
  initialAccounts?: Account[];
  initialSyncStatus?: SyncStatusResponse;
};

export function useAccountsPage(options: UseAccountsPageOptions = {}) {
  const router = useRouter();
  const hasInitialAccounts = options.initialAccounts !== undefined;
  const hasInitialSyncStatus = options.initialSyncStatus !== undefined;
  const didLoadRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<Account[]>(() => normalizeAccounts(options.initialAccounts ?? []));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>("all");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editType, setEditType] = useState<AccountType>("Free");
  const [editStatus, setEditStatus] = useState<AccountStatus>("正常");
  const [editQuota, setEditQuota] = useState("0");
  const [isLoading, setIsLoading] = useState(!hasInitialAccounts);
  const [refreshingAction, setRefreshingAction] = useState<"all" | "selected" | null>(null);
  const [refreshingRowToken, setRefreshingRowToken] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(options.initialSyncStatus ?? null);
  const [isSyncLoading, setIsSyncLoading] = useState(!hasInitialSyncStatus);
  const [syncRunningDirection, setSyncRunningDirection] = useState<"pull" | "push" | "both" | null>(null);

  const loadAccounts = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const data = await fetchAccounts();
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => pruneSelectedIds(prev, data.items));
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
    suppressError = false,
  }: {
    silent?: boolean;
    suppressError?: boolean;
  } = {}) => {
    if (!silent) {
      setIsSyncLoading(true);
    }
    try {
      const data = await fetchSyncStatus();
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
    if (hasInitialAccounts && hasInitialSyncStatus) {
      return;
    }

    void Promise.all([loadAccounts(hasInitialAccounts), loadSync()]);
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

  const filteredAccounts = useMemo(
    () => filterAndSortAccounts(accounts, { query, typeFilter, statusFilter }),
    [accounts, query, statusFilter, typeFilter],
  );

  const currentRows = filteredAccounts;
  const allCurrentSelected = currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row.id));
  const summary = useMemo(() => buildAccountsSummary(accounts), [accounts]);
  const selectedTokens = useMemo(() => getSelectedTokens(accounts, selectedIds), [accounts, selectedIds]);
  const abnormalTokens = useMemo(() => getAbnormalTokens(accounts), [accounts]);
  const syncView = useMemo(() => normalizeSyncStatus(syncStatus), [syncStatus]);
  const isAnyRefreshRunning = refreshingAction !== null || refreshingRowToken !== null;

  const handleImportFiles = async (files: FileList | null) => {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0) {
      return;
    }

    setIsImporting(true);
    try {
      const data = await importAccountFiles(normalizedFiles);
      setAccounts(normalizeAccounts(data.items));
      setSelectedIds((prev) => pruneSelectedIds(prev, data.items));
      await loadSync({ silent: true });

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
      setSelectedIds((prev) => pruneSelectedIds(prev, data.items));
      await loadSync({ silent: true });
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
      setSelectedIds((prev) => pruneSelectedIds(prev, data.items));
      await loadSync({ silent: true });
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
      await loadSync({ silent: true });

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

  const closeEditDialog = () => {
    setEditingAccount(null);
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
      setSelectedIds((prev) => pruneSelectedIds(prev, data.items));
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

  const toggleSelectedId = (accountId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, accountId])) : prev.filter((item) => item !== accountId),
    );
  };

  return {
    importInputRef,
    accounts,
    selectedIds,
    query,
    setQuery,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    editingAccount,
    editType,
    setEditType,
    editStatus,
    setEditStatus,
    editQuota,
    setEditQuota,
    isLoading,
    refreshingAction,
    refreshingRowToken,
    isImporting,
    isDeleting,
    isUpdating,
    isSyncLoading,
    syncRunningDirection,
    currentRows,
    filteredAccounts,
    allCurrentSelected,
    summary,
    selectedTokens,
    abnormalTokens,
    syncView,
    isAnyRefreshRunning,
    handleImportFiles,
    handleDeleteTokens,
    handleRefreshSelectedAccounts,
    handleRefreshAllLocalCredentials,
    handleRunSync,
    openEditDialog,
    closeEditDialog,
    handleUpdateAccount,
    toggleSelectAll,
    toggleSelectedId,
  };
}
