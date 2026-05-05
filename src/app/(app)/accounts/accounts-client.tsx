"use client";

import { AccountEditDialog } from "./_components/account-edit-dialog";
import { AccountSyncPanel } from "./_components/account-sync-panel";
import { AccountsTable } from "./_components/accounts-table";
import { AccountsToolbar } from "./_components/accounts-toolbar";
import { useAccountsPage } from "@/features/accounts/use-accounts-page";
import type { Account, SyncStatusResponse } from "@/lib/api";

type AccountsClientProps = {
  initialAccounts: Account[];
  initialSyncStatus: SyncStatusResponse;
};

export function AccountsClient({ initialAccounts, initialSyncStatus }: AccountsClientProps) {
  const {
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
  } = useAccountsPage({ initialAccounts, initialSyncStatus });

  return (
    <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1 shadow-none sm:rounded-[30px] sm:border sm:border-stone-200 sm:bg-[#fcfcfb] sm:px-5 sm:py-6 sm:shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:px-6 lg:py-7 dark:sm:border-stone-700 dark:sm:bg-stone-950">
      <div className="hidden sm:flex sm:flex-col sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300" />
          <div className="flex-1 -translate-y-[10px]">
            <h1 className="text-2xl font-bold tracking-tight text-stone-950 sm:text-[28px] dark:text-stone-50">号池管理</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">管理账号池与同步配置</p>
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

      <AccountEditDialog
        open={Boolean(editingAccount)}
        editStatus={editStatus}
        onEditStatusChange={setEditStatus}
        editType={editType}
        onEditTypeChange={setEditType}
        editQuota={editQuota}
        onEditQuotaChange={setEditQuota}
        isUpdating={isUpdating}
        onClose={closeEditDialog}
        onSave={handleUpdateAccount}
      />

      <AccountSyncPanel
        accountsCount={accounts.length}
        summary={summary}
        syncView={syncView}
        isSyncLoading={isSyncLoading}
        syncRunningDirection={syncRunningDirection}
        refreshingAction={refreshingAction}
        isAnyRefreshRunning={isAnyRefreshRunning}
        onRefreshAllLocalCredentials={handleRefreshAllLocalCredentials}
        onRunSync={handleRunSync}
      />

      <section className="mt-3.5 space-y-4">
        <AccountsToolbar
          filteredCount={filteredAccounts.length}
          query={query}
          onQueryChange={setQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          importInputRef={importInputRef}
          isImporting={isImporting}
        />

        <AccountsTable
          accountsCount={accounts.length}
          rows={currentRows}
          selectedIds={selectedIds}
          selectedTokens={selectedTokens}
          abnormalTokens={abnormalTokens}
          allCurrentSelected={allCurrentSelected}
          isLoading={isLoading}
          isDeleting={isDeleting}
          isUpdating={isUpdating}
          isAnyRefreshRunning={isAnyRefreshRunning}
          refreshingAction={refreshingAction}
          refreshingRowToken={refreshingRowToken}
          onRefreshSelectedAccounts={handleRefreshSelectedAccounts}
          onDeleteTokens={handleDeleteTokens}
          onOpenEditDialog={openEditDialog}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelectedId={toggleSelectedId}
        />
      </section>
    </div>
  );
}
