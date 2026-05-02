"use client";

import type { ComponentProps } from "react";
import { LoaderCircle, RefreshCcw, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountSummaryView, AccountSyncView } from "@/features/accounts/account-view-model";
import type { SyncStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

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

export type AccountSyncPanelProps = {
  accountsCount: number;
  summary: AccountSummaryView;
  syncView: AccountSyncView;
  isSyncLoading: boolean;
  syncRunningDirection: "pull" | "push" | "both" | null;
  refreshingAction: "all" | "selected" | null;
  isAnyRefreshRunning: boolean;
  onRefreshAllLocalCredentials: () => void | Promise<void>;
  onRunSync: (direction: "pull" | "push" | "both") => void | Promise<void>;
};

export function AccountSyncPanel({
  accountsCount,
  summary,
  syncView,
  isSyncLoading,
  syncRunningDirection,
  refreshingAction,
  isAnyRefreshRunning,
  onRefreshAllLocalCredentials,
  onRunSync,
}: AccountSyncPanelProps) {
  return (
    <section className="space-y-1.5">
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-3 p-4">
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
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                onClick={() => void onRefreshAllLocalCredentials()}
                disabled={accountsCount === 0 || isAnyRefreshRunning || syncRunningDirection !== null}
              >
                <RefreshCw className={cn("size-4", refreshingAction === "all" ? "animate-spin" : "")} />
                刷新本地凭证
              </Button>
              <Button
                className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
                onClick={() => void onRunSync("both")}
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
  );
}
