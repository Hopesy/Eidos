"use client";

import { AccountEditDialog } from "./_components/account-edit-dialog";
import { AccountSyncPanel } from "./_components/account-sync-panel";
import { AccountsTable } from "./_components/accounts-table";
import { AccountsToolbar } from "./_components/accounts-toolbar";
import { useAccountsPage } from "@/features/accounts/use-accounts-page";

export default function AccountsPage() {
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
  } = useAccountsPage();

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
