"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
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
                                        这里记录最近的图片请求实际走向，便于判断当前请求到底是
                                        <span className="mx-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">官方直连</span>
                                        还是
                                        <span className="mx-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">CPA</span>
                                        。
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

                <Card className="border-stone-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1120px] text-left">
                                <thead className="border-b border-stone-100 bg-stone-50/80 text-[11px] uppercase tracking-[0.18em] text-stone-400">
                                    <tr>
                                        <th className="whitespace-nowrap px-4 py-3">时间</th>
                                        <th className="whitespace-nowrap px-4 py-3">操作</th>
                                        <th className="whitespace-nowrap px-4 py-3">模式</th>
                                        <th className="whitespace-nowrap px-4 py-3">方向</th>
                                        <th className="whitespace-nowrap px-4 py-3">路由</th>
                                        <th className="whitespace-nowrap px-4 py-3">接口</th>
                                        <th className="whitespace-nowrap px-4 py-3">账号</th>
                                        <th className="whitespace-nowrap px-4 py-3">模型</th>
                                        <th className="whitespace-nowrap px-4 py-3">结果</th>
                                        <th className="px-4 py-3">错误</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading
                                        ? Array.from({ length: 8 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse border-b border-stone-100/80">
                                                {Array.from({ length: 10 }).map((__, j) => (
                                                    <td key={j} className="px-4 py-3">
                                                        <div className="h-4 w-20 rounded bg-stone-100" />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                        : items.map((item) => (
                                            <tr key={item.id} className="border-b border-stone-100/80 text-sm text-stone-600 hover:bg-stone-50/70">
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <div className="font-medium text-stone-700">{formatTime(item.startedAt)}</div>
                                                    <div className="text-xs text-stone-400">{item.finishedAt ? formatTime(item.finishedAt) : "进行中"}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3">{item.operation || "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-700">
                                                        {item.imageMode || "studio"}
                                                    </Badge>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <Badge variant={item.direction === "cpa" ? "info" : "success"} className="rounded-md px-2 py-1">
                                                        {item.direction === "cpa" ? "CPA" : "官方"}
                                                    </Badge>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3">{item.route || "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-3">{item.endpoint || "—"}</td>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <div className="truncate text-stone-700" title={item.accountEmail || item.accountFile || ""}>
                                                        {item.accountEmail || "—"}
                                                    </div>
                                                    <div className="truncate text-xs text-stone-400" title={item.accountFile || ""}>
                                                        {item.accountType ? `${item.accountType} · ${item.accountFile || "—"}` : item.accountFile || "—"}
                                                    </div>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <div className="text-stone-700">{item.requestedModel || "—"}</div>
                                                    <div className="text-xs text-stone-400">{item.upstreamModel || "—"}</div>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <Badge variant={item.success ? "success" : "danger"} className="rounded-md px-2 py-1">
                                                        {item.success ? "成功" : "失败"}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="max-w-[320px] truncate text-xs text-stone-500" title={item.error || ""}>
                                                        {item.error || "—"}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        {!isLoading && items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                                <div className="rounded-2xl bg-stone-100 p-3 text-stone-500">
                                    <Activity className="size-5" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-stone-700">还没有调用记录</p>
                                    <p className="text-sm text-stone-500">发起一次图片请求后，这里会显示它到底走的是官方还是 CPA。</p>
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}
