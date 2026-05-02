"use client";

import { Activity, AlertCircle, RefreshCw } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    formatRequestTime,
    getRequestFinalStatusMeta,
    requestOperationFilterOptions,
    requestResultFilterOptions,
    resolveRequestFinalStatus,
    type RequestOperationFilter,
    type RequestResultFilter,
} from "@/features/requests/request-view-model";
import { useRequestsPage } from "@/features/requests/use-requests-page";
import type { RequestLogItem } from "@/lib/api";

type RequestsClientProps = {
    initialItems: RequestLogItem[];
};

export function RequestsClient({ initialItems }: RequestsClientProps) {
    const {
        isLoading,
        isRefreshing,
        resultFilter,
        setResultFilter,
        operationFilter,
        setOperationFilter,
        summary,
        filteredItems,
        sortedItems,
        refreshItems,
    } = useRequestsPage(initialItems);

    return (
        <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-5 overflow-y-auto rounded-[22px] border border-stone-200 bg-[#fcfcfb] px-3 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:rounded-[30px] sm:px-5 sm:py-6 lg:px-6 lg:py-7 dark:border-stone-700 dark:bg-stone-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300" />
                    <div className="flex-1 -translate-y-[10px]">
                        <h1 className="text-2xl font-bold tracking-tight text-stone-950 sm:text-[28px] dark:text-stone-50">调用请求</h1>
                        <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">查看图片生成请求历史与状态</p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-stone-300/60 bg-white px-4 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
                    onClick={() => void refreshItems()}
                    disabled={isRefreshing}
                >
                    {isRefreshing ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    刷新
                </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-gradient-to-br from-white to-stone-50/30 px-4 py-3.5 shadow-sm backdrop-blur-sm dark:border-stone-700 dark:from-stone-900 dark:to-stone-800/30">
                <div className="flex flex-wrap items-center gap-4">
                    {[
                        { label: "总记录", value: String(summary.total), color: "stone" },
                        { label: "成功", value: String(summary.success), color: "emerald" },
                        { label: "失败", value: String(summary.failed), color: "rose" },
                        { label: "最近", value: summary.latest ? formatRequestTime(summary.latest) : "—", color: "blue" },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="flex items-center gap-2">
                            <div className={`size-2 rounded-full ${
                                color === "emerald" ? "bg-emerald-500" :
                                color === "rose" ? "bg-rose-500" :
                                color === "blue" ? "bg-blue-500" :
                                "bg-stone-400"
                            }`} />
                            <span className="text-[11px] font-medium text-stone-400 dark:text-stone-500">{label}</span>
                            <span className={`text-sm font-semibold ${
                                color === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
                                color === "rose" ? "text-rose-600 dark:text-rose-400" :
                                color === "blue" ? "text-blue-600 dark:text-blue-400" :
                                "text-stone-900 dark:text-stone-100"
                            }`}>{value}</span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={resultFilter} onValueChange={(value) => setResultFilter(value as RequestResultFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {requestResultFilterOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as RequestOperationFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {requestOperationFilterOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{filteredItems.length} 条记录</span>
                </div>
            </div>

            <div className="space-y-3 lg:hidden">
                {isLoading
                    ? Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-32 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900" />
                    ))
                    : sortedItems.map((item) => {
                        const finalStatus = resolveRequestFinalStatus(item);
                        const finalMeta = getRequestFinalStatusMeta(finalStatus);
                        return (
                            <div
                                key={item.id}
                                className={`rounded-2xl border p-3 shadow-sm ${
                                    item.success
                                        ? "border-stone-200/60 bg-white dark:border-stone-700 dark:bg-stone-900"
                                        : "border-rose-100 bg-rose-50/70 dark:border-rose-900/30 dark:bg-rose-900/20"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-medium text-stone-700 dark:text-stone-300">
                                            {formatRequestTime(item.startedAt)}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                                {item.operation || "—"}
                                            </span>
                                            <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                                {item.model || "—"}
                                            </span>
                                        </div>
                                    </div>
                                    <Badge variant={finalMeta.variant} className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px]">
                                        {finalMeta.label}
                                    </Badge>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                    <div className="rounded-xl bg-white/70 px-2.5 py-2 dark:bg-stone-800/60">
                                        <div className="text-stone-400">数量</div>
                                        <div className="mt-1 font-medium text-stone-700 dark:text-stone-300">{item.count ?? "—"}</div>
                                    </div>
                                    <div className="rounded-xl bg-white/70 px-2.5 py-2 dark:bg-stone-800/60">
                                        <div className="text-stone-400">尝试</div>
                                        <div className="mt-1 font-medium text-stone-700 dark:text-stone-300">{item.attemptCount ?? "—"}</div>
                                    </div>
                                    <div className="rounded-xl bg-white/70 px-2.5 py-2 dark:bg-stone-800/60">
                                        <div className="text-stone-400">耗时</div>
                                        <div className="mt-1 font-medium text-stone-700 dark:text-stone-300">
                                            {item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : "—"}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 space-y-1 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-stone-400">接口</span>
                                        <span className="truncate text-right text-stone-600 dark:text-stone-300">{item.endpoint || "—"}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-stone-400">账号</span>
                                        <span className="truncate text-right text-stone-600 dark:text-stone-300">{item.accountEmail || "—"}</span>
                                    </div>
                                </div>

                                {item.error || item.failureKind || item.retryAction || item.stage ? (
                                    <div className="mt-3 rounded-xl border border-rose-100 bg-white/80 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-900/30 dark:bg-stone-900/60 dark:text-rose-300">
                                        {item.error ? (
                                            <div className="line-clamp-3 break-all">{item.error}</div>
                                        ) : null}
                                        {item.failureKind || item.retryAction || item.stage ? (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {item.failureKind ? <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{item.failureKind}</span> : null}
                                                {item.retryAction ? <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">{item.retryAction}</span> : null}
                                                {item.stage ? <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">{item.stage}</span> : null}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                {!isLoading && filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-stone-200/60 bg-white px-6 py-16 text-center shadow-sm dark:border-stone-700 dark:bg-stone-900">
                        <div className="rounded-2xl bg-stone-100 p-3 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                            <Activity className="size-5" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-stone-700 dark:text-stone-300">没有匹配的调用记录</p>
                            <p className="text-sm text-stone-500 dark:text-stone-400">切换筛选条件，或者先发起一次图片请求。</p>
                        </div>
                    </div>
                ) : null}
            </div>

            <Card className="hidden border-stone-200/60 bg-white shadow-sm lg:block dark:border-stone-700 dark:bg-stone-900">
                <CardContent className="p-0">
                    <div className="h-[420px] overflow-y-auto">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1140px] text-left">
                                <thead className="sticky top-0 z-10 border-b border-stone-100 bg-stone-50/95 backdrop-blur-sm dark:border-stone-800 dark:bg-stone-800/95">
                                    <tr>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">时间</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">操作</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">接口</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">模型</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">数量</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">尝试次数</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">最终态</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">API 风格</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">状态码</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">账号</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">耗时</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">结果</th>
                                        <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">错误</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading
                                        ? Array.from({ length: 8 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse border-b border-stone-100/80">
                                                {Array.from({ length: 13 }).map((__, j) => (
                                                    <td key={j} className="px-3 py-2">
                                                        <div className="h-3 w-16 rounded bg-stone-100" />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                        : sortedItems.map((item) => (
                                            <tr key={item.id} className={`border-b text-xs transition-colors ${item.success ? "border-stone-100/80 text-stone-600 hover:bg-stone-50/70 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-800/70" : "border-rose-100 bg-rose-50/45 text-rose-900 hover:bg-rose-50/70 dark:border-rose-900/30 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"}`}>
                                                {(() => {
                                                    const finalStatus = resolveRequestFinalStatus(item);
                                                    const finalMeta = getRequestFinalStatusMeta(finalStatus);
                                                    return (
                                                        <>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <div className="text-[11px] font-medium text-stone-700">{formatRequestTime(item.startedAt)}</div>
                                                    <div className="text-[10px] text-stone-400">{item.finishedAt ? formatRequestTime(item.finishedAt) : "进行中"}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                                                        {item.operation || "—"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2 text-[10px] text-stone-500">{item.endpoint || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-stone-700">{item.model || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-center text-[10px] text-stone-600">{item.count ?? "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-center text-[10px] font-medium text-stone-700">
                                                    {item.attemptCount ?? "—"}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <Badge variant={finalMeta.variant} className="rounded-md px-1.5 py-0.5 text-[10px]">
                                                        {finalMeta.label}
                                                    </Badge>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                                                        {item.apiStyle || "—"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-[10px] text-stone-600">
                                                    {item.statusCode ?? "—"}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <div className="truncate text-[11px] text-stone-700" title={item.accountEmail || ""}>
                                                        {item.accountEmail || "—"}
                                                    </div>
                                                    {item.accountType ? (
                                                        <div className="text-[10px] text-stone-400">{item.accountType}</div>
                                                    ) : null}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2 text-[10px] text-stone-500">
                                                    {item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : "—"}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <Badge variant={item.success ? "success" : "danger"} className="rounded-md px-1.5 py-0.5 text-[10px]">
                                                        {item.success ? "成功" : "失败"}
                                                    </Badge>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {item.error || item.failureKind || item.retryAction || item.stage || item.upstreamConversationId || item.upstreamResponseId ? (
                                                        <div className={`max-w-[320px] space-y-1.5 rounded-lg border px-2 py-1.5 text-[10px] leading-4 ${item.success ? "border-stone-200 bg-stone-50 text-stone-500" : "border-rose-200 bg-white text-rose-700"}`}>
                                                            {item.error ? (
                                                                <div className="flex items-start gap-1.5" title={item.error}>
                                                                    {!item.success ? <AlertCircle className="mt-0.5 size-3 shrink-0" /> : null}
                                                                    <span className="line-clamp-2 break-all">{item.error}</span>
                                                                </div>
                                                            ) : null}
                                                            {item.failureKind || item.retryAction || item.stage ? (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {item.failureKind ? (
                                                                        <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                                                            {item.failureKind}
                                                                        </span>
                                                                    ) : null}
                                                                    {item.retryAction ? (
                                                                        <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                                                            {item.retryAction}
                                                                        </span>
                                                                    ) : null}
                                                                    {item.stage ? (
                                                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                                                            {item.stage}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                            {item.upstreamConversationId || item.upstreamResponseId ? (
                                                                <div className="space-y-0.5 text-[10px] text-stone-500 dark:text-stone-400">
                                                                    {item.upstreamConversationId ? (
                                                                        <div className="break-all">
                                                                            <span className="mr-1 text-stone-400">conv</span>
                                                                            <span className="font-mono">{item.upstreamConversationId}</span>
                                                                        </div>
                                                                    ) : null}
                                                                    {item.upstreamResponseId ? (
                                                                        <div className="break-all">
                                                                            <span className="mr-1 text-stone-400">resp</span>
                                                                            <span className="font-mono">{item.upstreamResponseId}</span>
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : (
                                                        <div className="text-[10px] text-stone-400">—</div>
                                                    )}
                                                </td>
                                                        </>
                                                    );
                                                })()}
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        {!isLoading && filteredItems.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                                <div className="rounded-2xl bg-stone-100 p-3 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                                    <Activity className="size-5" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-stone-700 dark:text-stone-300">没有匹配的调用记录</p>
                                    <p className="text-sm text-stone-500 dark:text-stone-400">试试切换成功/失败或操作类型筛选，或者先发起一次图片请求。</p>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
