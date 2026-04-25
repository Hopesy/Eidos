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
    const [pageSize, setPageSize] = useState<"20" | "50" | "100">("20");
    const [page, setPage] = useState(1);

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

    const totalPages = Math.max(1, Math.ceil(sortedItems.length / Number(pageSize)));

    const pagedItems = useMemo(() => {
        const size = Number(pageSize);
        const start = (page - 1) * size;
        return sortedItems.slice(start, start + size);
    }, [page, pageSize, sortedItems]);

    useEffect(() => {
        setPage(1);
    }, [operationFilter, pageSize, resultFilter]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    return (
        <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-5 overflow-y-auto rounded-[30px] border border-stone-200 bg-[#fcfcfb] px-4 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-5 sm:py-6 lg:px-6 lg:py-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm" />
                    <div className="flex-1 -translate-y-[10px]">
                        <h1 className="text-[28px] font-bold tracking-tight text-stone-950">调用请求</h1>
                        <p className="mt-1 text-[13px] leading-relaxed text-stone-500">查看图片生成请求历史与状态</p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-stone-300/60 bg-white px-4 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow"
                    onClick={() => void loadItems(true)}
                    disabled={isRefreshing}
                >
                    {isRefreshing ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    刷新
                </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-gradient-to-br from-white to-stone-50/30 px-4 py-3.5 shadow-sm backdrop-blur-sm">
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
                            <span className="text-[11px] font-medium text-stone-400">{label}</span>
                            <span className={`text-sm font-semibold ${
                                color === "emerald" ? "text-emerald-600" :
                                color === "rose" ? "text-rose-600" :
                                color === "blue" ? "text-blue-600" :
                                "text-stone-900"
                            }`}>{value}</span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={resultFilter} onValueChange={(value) => setResultFilter(value as typeof resultFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="success">成功</SelectItem>
                            <SelectItem value="failed">失败</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as typeof operationFilter)}>
                        <SelectTrigger className="h-8 w-[110px] rounded-lg border-stone-200 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部操作</SelectItem>
                            <SelectItem value="generate">generate</SelectItem>
                            <SelectItem value="edit">edit</SelectItem>
                            <SelectItem value="upscale">upscale</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={pageSize} onValueChange={(value) => setPageSize(value as typeof pageSize)}>
                        <SelectTrigger className="h-8 w-[85px] rounded-lg border-stone-200 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="20">20</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-stone-500">{pagedItems.length} / {filteredItems.length}</span>
                </div>
            </div>

            <Card className="border-stone-200/60 bg-white shadow-sm">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-left">
                            <thead className="border-b border-stone-100 bg-stone-50/40">
                                <tr>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">时间</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">操作</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">接口</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">模型</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">数量</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">账号</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">耗时</th>
                                    <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">结果</th>
                                    <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">错误</th>
                                </tr>
                            </thead>
                                <tbody>
                                    {isLoading
                                        ? Array.from({ length: 8 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse border-b border-stone-100/80">
                                                {Array.from({ length: 9 }).map((__, j) => (
                                                    <td key={j} className="px-4 py-3">
                                                        <div className="h-4 w-20 rounded bg-stone-100" />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                        : pagedItems.map((item) => (
                                            <tr key={item.id} className={`border-b text-sm transition-colors ${item.success ? "border-stone-100/80 text-stone-600 hover:bg-stone-50/70" : "border-rose-100 bg-rose-50/45 text-rose-900 hover:bg-rose-50/70"}`}>
                                                <td className="whitespace-nowrap px-4 py-2.5">
                                                    <div className="font-medium text-stone-700">{formatTime(item.startedAt)}</div>
                                                    <div className="text-xs text-stone-400">{item.finishedAt ? formatTime(item.finishedAt) : "进行中"}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5">
                                                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                                                        {item.operation || "—"}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-stone-500">{item.endpoint || "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-stone-700">{item.model || "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-center text-xs text-stone-600">{item.count ?? "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-2.5">
                                                    <div className="truncate text-stone-700" title={item.accountEmail || ""}>
                                                        {item.accountEmail || "—"}
                                                    </div>
                                                    {item.accountType ? (
                                                        <div className="text-xs text-stone-400">{item.accountType}</div>
                                                    ) : null}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-stone-500">
                                                    {item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : "—"}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-2.5">
                                                    <Badge variant={item.success ? "success" : "danger"} className="rounded-md px-2 py-1">
                                                        {item.success ? "成功" : "失败优先"}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    {item.error ? (
                                                        <div className={`max-w-[320px] rounded-xl border px-3 py-2 text-xs leading-5 ${item.success ? "border-stone-200 bg-stone-50 text-stone-500" : "border-rose-200 bg-white text-rose-700"}`} title={item.error}>
                                                            <div className="flex items-start gap-2">
                                                                {!item.success ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : null}
                                                                <span className="line-clamp-3 break-all">{item.error}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-stone-400">—</div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        {!isLoading && filteredItems.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                                <div className="rounded-2xl bg-stone-100 p-3 text-stone-500">
                                    <Activity className="size-5" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-stone-700">没有匹配的调用记录</p>
                                    <p className="text-sm text-stone-500">试试切换成功/失败或操作类型筛选，或者先发起一次图片请求。</p>
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

            {!isLoading && filteredItems.length > 0 && (
                <div className="flex items-center justify-between rounded-2xl border border-stone-200/60 bg-white/50 px-4 py-3 backdrop-blur-sm">
                    <span className="text-sm text-stone-500">第 {page} / {totalPages} 页</span>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-stone-200 px-3 text-xs"
                            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                            disabled={page <= 1}
                        >
                            上一页
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-stone-200 px-3 text-xs"
                            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={page >= totalPages}
                        >
                            下一页
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
