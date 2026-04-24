"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchRequestLogs, type RequestLogItem } from "@/lib/api";

function formatTime(value: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
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
            const message = error instanceof Error ? error.message : "加载请求日志失败";
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <section className="h-full overflow-y-auto">
            <div className="mx-auto max-w-screen-2xl space-y-4 p-6">
                {/* 顶部介绍卡片 */}
                <Card>
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Activity className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-lg font-semibold leading-tight">调用请求</h1>
                                <p className="text-sm text-muted-foreground">
                                    查看最近的 API 调用请求记录，包括操作类型、路由、账号、模型及结果。
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadItems}
                            disabled={isLoading}
                            className="shrink-0"
                        >
                            <RefreshCw className={`mr-1.5 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                            刷新
                        </Button>
                    </CardContent>
                </Card>

                {/* 表格卡片 */}
                <Card>
                    <CardContent className="p-0">
                        {items.length === 0 && !isLoading ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
                                <Activity className="h-10 w-10 opacity-30" />
                                <span className="text-sm">还没有调用记录</span>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">时间</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">操作</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">模式</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">方向</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">路由</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">接口</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">账号</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">模型</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">结果</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left font-medium">错误</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {isLoading
                                            ? Array.from({ length: 8 }).map((_, i) => (
                                                <tr key={i} className="animate-pulse">
                                                    {Array.from({ length: 10 }).map((__, j) => (
                                                        <td key={j} className="px-4 py-3">
                                                            <div className="h-4 w-20 rounded bg-muted" />
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))
                                            : items.map((item) => (
                                                <tr
                                                    key={item.id}
                                                    className="transition-colors hover:bg-muted/30"
                                                >
                                                    {/* 时间 */}
                                                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                                                        {formatTime(item.startedAt)}
                                                    </td>
                                                    {/* 操作 */}
                                                    <td className="whitespace-nowrap px-4 py-3">
                                                        <span className="font-medium">{item.operation || "—"}</span>
                                                    </td>
                                                    {/* 模式 */}
                                                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                        {item.imageMode || "—"}
                                                    </td>
                                                    {/* 方向 */}
                                                    <td className="whitespace-nowrap px-4 py-3">
                                                        {item.direction === "cpa" ? (
                                                            <Badge variant="info">CPA</Badge>
                                                        ) : (
                                                            <Badge variant="success">官方</Badge>
                                                        )}
                                                    </td>
                                                    {/* 路由 */}
                                                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                        {item.route || "—"}
                                                    </td>
                                                    {/* 接口 */}
                                                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                        {item.endpoint || "—"}
                                                    </td>
                                                    {/* 账号 */}
                                                    <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                                                        <span title={item.accountEmail ?? item.accountFile ?? undefined}>
                                                            {item.accountEmail ?? item.accountFile ?? "—"}
                                                        </span>
                                                    </td>
                                                    {/* 模型 */}
                                                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                        {item.upstreamModel ?? item.requestedModel ?? "—"}
                                                    </td>
                                                    {/* 结果 */}
                                                    <td className="whitespace-nowrap px-4 py-3">
                                                        {item.success ? (
                                                            <Badge variant="success">成功</Badge>
                                                        ) : (
                                                            <Badge variant="danger">失败</Badge>
                                                        )}
                                                    </td>
                                                    {/* 错误 */}
                                                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-rose-500">
                                                        <span title={item.error ?? undefined}>{item.error ?? "—"}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}
