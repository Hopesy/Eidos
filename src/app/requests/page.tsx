"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, RefreshCw } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchRequestLogs, type RequestLogItem } from "@/lib/api";

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value || "—";
    }
    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(date);
}

export default function RequestsPage() {
    const [items, setItems] = useState<RequestLogItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [resultFilter, setResultFilter] = useState<"all" | "success" | "failed">("all");
    const [operationFilter, setOperationFilter] = useState<"all" | "generate" | "edit" | "upscale">("all");

    const loadItems = async (isRefresh = false) => {
        if (isRefresh) {
            setIsRefreshing(true);
        } else {
            setIsLoading(true);
        }
        try {
            const data = await fetchRequestLogs();
            setItems(data.items);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "读取调用请求失败");
        } finally {
            if (isRefresh) {
                setIsRefreshing(false);
            } else {
                setIsLoading(false);
            }
        }
    };

    useEffect(() => {
        void loadItems();
    }, []);

    const summary = useMemo(() => {
        const success = items.filter((item) => item.success).length;
        const failed = items.filter((item) => !item.success).length;
        const latest = items[0]?.finishedAt || items[0]?.startedAt || "";
        return { total: items.length, success, failed, latest };
    }, [items]);

    const filteredItems = useMemo(() => {
        return items.filter((item) => {
            const matchesResult =
                resultFilter === "all" ||
                (resultFilter === "success" ? item.success : !item.success);
            const normalizedOperation = String(item.operation || "").trim().toLowerCase();
            const matchesOperation =
                operationFilter === "all" || normalizedOperation === operationFilter;
            return matchesResult && matchesOperation;
        });
    }, [items, operationFilter, resultFilter]);

    const sortedItems = useMemo(() => {
        return [...filteredItems].sort((a, b) => {
            if (a.success !== b.success) {
                return a.success ? 1 : -1;
            }
            return (b.finishedAt || b.startedAt || "").localeCompare(a.finishedAt || a.startedAt || "");
        });
    }, [filteredItems]);

    return (
        <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-5 overflow-y-auto rounded-[30px] border border-stone-200 bg-[#fcfcfb] px-4 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-5 sm:py-6 lg:px-6 lg:py-7 dark:border-stone-700 dark:bg-stone-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300" />
                    <div className="flex-1 -translate-y-[10px]">
                        <h1 className="text-[28px] font-bold tracking-tight text-stone-950 dark:text-stone-50">调用请求</h1>
                        <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">查看图片生成请求历史与状态</p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-stone-300/60 bg-white px-4 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
                    onClick={() => void loadItems(true)}
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
                        { label: "最近", value: summary.latest ? formatTime(summary.latest) : "—", color: "blue" },
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
                    <Select value={resultFilter} onValueChange={(value) => setResultFilter(value as typeof resultFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="success">成功</SelectItem>
                            <SelectItem value="failed">失败</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as typeof operationFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部操作</SelectItem>
                            <SelectItem value="generate">generate</SelectItem>
                            <SelectItem value="edit">edit</SelectItem>
                            <SelectItem value="upscale">upscale</SelectItem>
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{filteredItems.length} 条记录</span>
                </div>
            </div>

            <Card className="border-stone-200/60 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
                <CardContent className="p-0">
                    <div className="h-[420px] overflow-y-auto">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[860px] text-left">
                                <thead className="sticky top-0 z-10 border-b border-stone-100 bg-stone-50/95 backdrop-blur-sm dark:border-stone-800 dark:bg-stone-800/95">
                                    <tr>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">时间</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">操作</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">接口</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">模型</th>
                                        <th className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">数量</th>
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
                                                {Array.from({ length: 9 }).map((__, j) => (
                                                    <td key={j} className="px-3 py-2">
                                                        <div className="h-3 w-16 rounded bg-stone-100" />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                        : sortedItems.map((item) => (
                                            <tr key={item.id} className={`border-b text-xs transition-colors ${item.success ? "border-stone-100/80 text-stone-600 hover:bg-stone-50/70 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-800/70" : "border-rose-100 bg-rose-50/45 text-rose-900 hover:bg-rose-50/70 dark:border-rose-900/30 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"}`}>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <div className="text-[11px] font-medium text-stone-700">{formatTime(item.startedAt)}</div>
                                                    <div className="text-[10px] text-stone-400">{item.finishedAt ? formatTime(item.finishedAt) : "进行中"}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">
                                                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                                                        {item.operation || "—"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2 text-[10px] text-stone-500">{item.endpoint || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-stone-700">{item.model || "—"}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-center text-[10px] text-stone-600">{item.count ?? "—"}</td>
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
                                                    {item.error ? (
                                                        <div className={`max-w-[280px] rounded-lg border px-2 py-1.5 text-[10px] leading-4 ${item.success ? "border-stone-200 bg-stone-50 text-stone-500" : "border-rose-200 bg-white text-rose-700"}`} title={item.error}>
                                                            <div className="flex items-start gap-1.5">
                                                                {!item.success ? <AlertCircle className="mt-0.5 size-3 shrink-0" /> : null}
                                                                <span className="line-clamp-2 break-all">{item.error}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[10px] text-stone-400">—</div>
                                                    )}
                                                </td>
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
