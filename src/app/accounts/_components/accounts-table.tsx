"use client";

import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleOff,
  Copy,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  extractImageGenLimit,
  formatQuota,
  formatRelativeTime,
  formatTableTime,
  maskToken,
} from "@/features/accounts/account-view-model";
import type { Account, AccountStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusIconMap: Record<AccountStatus, typeof CheckCircle2> = {
  正常: CheckCircle2,
  限流: CircleAlert,
  异常: CircleOff,
  禁用: Ban,
};

export type AccountsTableProps = {
  accountsCount: number;
  rows: Account[];
  selectedIds: string[];
  selectedTokens: string[];
  abnormalTokens: string[];
  allCurrentSelected: boolean;
  isLoading: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  isAnyRefreshRunning: boolean;
  refreshingAction: "all" | "selected" | null;
  refreshingRowToken: string | null;
  onRefreshSelectedAccounts: (
    accessTokens: string[],
    source?: "all" | "selected" | "row",
    rowToken?: string,
  ) => void | Promise<void>;
  onDeleteTokens: (tokens: string[]) => void | Promise<void>;
  onOpenEditDialog: (account: Account) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onToggleSelectedId: (accountId: string, checked: boolean) => void;
};

export function AccountsTable({
  accountsCount,
  rows,
  selectedIds,
  selectedTokens,
  abnormalTokens,
  allCurrentSelected,
  isLoading,
  isDeleting,
  isUpdating,
  isAnyRefreshRunning,
  refreshingAction,
  refreshingRowToken,
  onRefreshSelectedAccounts,
  onDeleteTokens,
  onOpenEditDialog,
  onToggleSelectAll,
  onToggleSelectedId,
}: AccountsTableProps) {
  return (
    <>
      {isLoading && accountsCount === 0 ? (
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
          isLoading && accountsCount === 0 ? "hidden" : "",
        )}
      >
        <CardContent className="space-y-0 p-0">
          <div className="flex flex-col gap-3 border-b border-stone-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
              <Button
                variant="ghost"
                className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100"
                onClick={() => void onRefreshSelectedAccounts(selectedTokens, "selected")}
                disabled={selectedTokens.length === 0 || isAnyRefreshRunning}
              >
                {refreshingAction === "selected" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新选中账号信息
              </Button>
              <Button
                variant="ghost"
                className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                onClick={() => void onDeleteTokens(abnormalTokens)}
                disabled={abnormalTokens.length === 0 || isDeleting}
              >
                {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                移除异常账号
              </Button>
              <Button
                variant="ghost"
                className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                onClick={() => void onDeleteTokens(selectedTokens)}
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
                    <Checkbox checked={allCurrentSelected} onCheckedChange={(checked) => onToggleSelectAll(Boolean(checked))} />
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
                {rows.map((account) => {
                  const StatusIcon = statusIconMap[account.status];
                  const imageGenLimit = extractImageGenLimit(account);
                  const imageGenRemaining = imageGenLimit.remaining;
                  const imageGenRestore = formatRelativeTime(imageGenLimit.resetAfter);

                  return (
                    <tr
                      key={account.id}
                      className="group border-b border-stone-100/80 text-sm transition-colors hover:bg-stone-50/60"
                    >
                      <td className="px-3 py-1.5 text-center">
                        <Checkbox
                          checked={selectedIds.includes(account.id)}
                          onCheckedChange={(checked) => {
                            onToggleSelectedId(account.id, Boolean(checked));
                          }}
                        />
                      </td>

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

                      <td className="px-3 py-1.5 text-center whitespace-nowrap">
                        <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                          {account.type}
                        </span>
                      </td>

                      <td className="px-3 py-1.5 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-sm font-semibold tabular-nums text-stone-800">
                            {imageGenRemaining == null ? "—" : formatQuota(imageGenRemaining)}
                          </span>
                          <span className="text-[11px] text-stone-400">/ {formatQuota(account.quota)}</span>
                        </div>
                      </td>

                      <td className="px-3 py-1.5 text-center whitespace-nowrap">
                        <span className="font-mono tabular-nums text-xs text-stone-500">
                          {formatTableTime(account.lastRefreshedAt)}
                        </span>
                      </td>

                      <td className="px-3 py-1.5 text-center text-xs text-stone-500 whitespace-nowrap">
                        <span className="font-medium text-stone-700">{imageGenRestore}</span>
                      </td>

                      <td className="px-3 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-0.5 text-stone-400">
                          <button
                            type="button"
                            className="rounded-lg p-1.5 transition hover:bg-stone-100 hover:text-stone-700"
                            onClick={() => onOpenEditDialog(account)}
                            disabled={isUpdating}
                            title="编辑"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-1.5 transition hover:bg-sky-50 hover:text-sky-500"
                            onClick={() => void onRefreshSelectedAccounts([account.access_token], "row", account.access_token)}
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
                            onClick={() => void onDeleteTokens([account.access_token])}
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

            {!isLoading && rows.length === 0 ? (
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
    </>
  );
}
