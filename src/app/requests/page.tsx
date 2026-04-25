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
    const [resultFilter, setResultFilter] = useState<"all" | "success" | "failed">("all");
    const [operationFilter, setOperationFilter] = useState<"all" | "generate" | "edit" | "upscale">("all");
    const [pageSize, setPageSize] = useState<"20" | "50" | "100">("20");
    const [page, setPage] = useState(1);

    const loadItems = async () => {
        setIsLoading(true);
        try {
            const data = await fetchRequestLogs();
            setItems(data.items);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "读取调用请求失败");
        } finally {
            setIsLoading(false);
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
        <section className="h-full overflow-y-auto">
            <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-1 py-1">
                <div className="rounded-[30px] border border-stone-200 bg-white px-5 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-start gap-4">
                                <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
                                    <Activity className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold tracking-tight text-stone-950">调用请求</h1>
                                    <p className="mt-2 max-w-[840px] text-sm leading-7 text-stone-500">
                                        这里展示最近持久化到
                                        <span className="mx-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">data/eidos.db</span>
                                        的图片请求历史。服务重启后记录仍会保留，便于回看账号、耗时和失败原因。
                                    </p>
                                </div>
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-700 shadow-none"
                            onClick={() => void loadItems()}
                            disabled={isLoading}
                        >
                            {isLoading ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                            刷新记录
                        </Button>
                    </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                        ["总记录", String(summary.total)],
                        ["成功", String(summary.success)],
                        ["失败", String(summary.failed)],
                        ["最近更新", summary.latest ? formatTime(summary.latest) : "—"],
                    ].map(([label, value]) => (
                        <Card key={label} className="border-stone-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
                            <CardContent className="px-4 py-4">
                                <div className="text-xs font-medium text-stone-400">{label}</div>
                                <div className="mt-2 text-xl font-semibold tracking-tight text-stone-900">{value}</div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <div className="rounded-[24px] border border-stone-200 bg-white px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                            <Select value={resultFilter} onValueChange={(value) => setResultFilter(value as typeof resultFilter)}>
                                <SelectTrigger className="h-9 w-[140px] rounded-full border-stone-200 bg-stone-50/50 text-sm shadow-none transition-colors hover:bg-stone-100/50">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">全部结果</SelectItem>
                                    <SelectItem value="success">仅成功</SelectItem>
                                    <SelectItem value="failed">仅失败</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={operationFilter} onValueChange={(value) => setOperationFilter(value as typeof operationFilter)}>
                                <SelectTrigger className="h-9 w-[140px] rounded-full border-stone-200 bg-stone-50/50 text-sm shadow-none transition-colors hover:bg-stone-100/50">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">全部操作</SelectItem>
                                    <SelectItem value="generate">generate</SelectItem>
                                    <SelectItem value="edit">edit</SelectItem>
                                    <SelectItem value="upscale">upscale</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="h-4 w-px bg-stone-200" />
                            <Select value={pageSize} onValueChange={(value) => setPageSize(value as typeof pageSize)}>
                                <SelectTrigger className="h-9 w-[110px] rounded-full border-stone-200 bg-stone-50/50 text-sm shadow-none transition-colors hover:bg-stone-100/50">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="20">20 条</SelectItem>
                                    <SelectItem value="50">50 条</SelectItem>
                                    <SelectItem value="100">100 条</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="text-sm text-stone-500">
                            显示 <span className="font-medium text-stone-700">{pagedItems.length}</span> / <span className="font-medium text-stone-700">{filteredItems.length}</span> 条（共 {items.length}）
                        </div>
                    </div>
                </div>

                <Card className="border-stone-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[860px] text-left">
                                <thead className="border-b border-stone-100 bg-stone-50/60">
                                    <tr>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">时间</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">操作</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">接口</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">模型</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">数量</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">账号</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">耗时</th>
                                        <th className="whitespace-nowrap px-4 py-2 text-[11px] font-medium text-stone-400">结果</th>
                                        <th className="px-4 py-2 text-[11px] font-medium text-stone-400">错误</th>
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

                {!isLoading && filteredItems.length > 0 ? (
                    <div className="flex flex-col gap-3 rounded-[24px] border border-stone-200 bg-white px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-stone-500">第 {page} / {totalPages} 页</div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-700 shadow-none"
                                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                disabled={page <= 1}
                            >
                                上一页
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-700 shadow-none"
                                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={page >= totalPages}
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
