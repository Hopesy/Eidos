"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleHelp, LoaderCircle, RefreshCcw, RefreshCw, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { fetchConfig, fetchDefaultConfig, updateConfig, type ConfigPayload, type ImageProviderMode } from "@/lib/api";
import { clearCachedSyncStatus } from "@/store/sync-status-cache";

function firstNonEmptyValue<T>(...values: (T | undefined | null)[]): T | undefined {
    return values.find((v): v is T => v !== undefined && v !== null && (v as unknown) !== "");
}

function defaultConfigPayload(): ConfigPayload {
    return {
        image: {
            mode: "studio",
        },
        chatgpt: {
            baseUrl: "",
            timeout: 60000,
        },
        cpa: {
            enabled: false,
            baseUrl: "",
        },
        proxy: {
            enabled: false,
            url: "",
        },
        server: {
            host: "0.0.0.0",
            port: 3000,
        },
        log: {
            level: "info",
            maxItems: 1000,
        },
        app: {
            authKey: "",
        },
        accounts: {
            defaultQuota: 5,
            autoRefresh: false,
            refreshInterval: 30,
        },
        storage: {
            type: "sqlite",
            path: "data/eidos.db",
        },
        sync: {
            enabled: false,
            provider: "",
            direction: "both",
            interval: 300,
        },
        paths: {
            data: "",
            logs: "",
        },
    } as ConfigPayload;
}

function HintTooltip({ text }: { text: string }) {
    return (
        <span className="relative inline-flex items-center group">
            <CircleHelp
                className="size-4 text-stone-400 transition-colors hover:text-stone-600"
                aria-hidden="true"
            />
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-xs leading-6 text-stone-600 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] group-hover:block group-focus-within:block">
                {text}
            </span>
        </span>
    );
}

function TooltipDetails({ items }: { items: { label: string; value: string }[] }) {
    return (
        <dl className="mt-1 space-y-0.5 text-xs text-stone-500">
            {items.map(({ label, value }) => (
                <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                    <dt className="text-stone-400">{label}</dt>
                    <dd className="break-all text-stone-700">{value || "—"}</dd>
                </div>
            ))}
        </dl>
    );
}

function LabelWithHint({
    id,
    label,
    hint,
}: {
    id: string;
    label: string;
    hint?: string;
}) {
    return (
        <label htmlFor={id} className="mb-2 flex items-center gap-1.5 text-sm font-medium text-stone-700">
            <span>{label}</span>
            {hint ? <HintTooltip text={hint} /> : null}
        </label>
    );
}

function ConfigSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <Card className="border-stone-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)] rounded-[28px]">
            <CardContent className="px-6 py-6">
                <div className="mb-5">
                    <h2 className="text-base font-semibold tracking-tight text-stone-900">{title}</h2>
                    {description ? <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">{children}</div>
            </CardContent>
        </Card>
    );
}

function Field({
    id,
    label,
    hint,
    children,
}: {
    id: string;
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <LabelWithHint id={id} label={label} hint={hint} />
            {children}
        </div>
    );
}

function ToggleField({
    id,
    label,
    hint,
    checked,
    onCheckedChange,
}: {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 md:col-span-2">
            <div className="flex items-center gap-3">
                <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
                <div className="min-w-0">
                    <label htmlFor={id} className="text-sm font-medium text-stone-700">
                        {label}
                    </label>
                    {hint ? <p className="mt-1 text-xs leading-5 text-stone-500">{hint}</p> : null}
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const [config, setConfig] = useState<ConfigPayload>(defaultConfigPayload());
    const [savedConfig, setSavedConfig] = useState<ConfigPayload>(defaultConfigPayload());
    const [defaultConfig, setDefaultConfig] = useState<ConfigPayload>(defaultConfigPayload());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [reloading, setReloading] = useState(false);

    const isDirty = useMemo(
        () => JSON.stringify(config) !== JSON.stringify(savedConfig),
        [config, savedConfig],
    );

    async function loadConfig() {
        try {
            const [cfgRes, defRes] = await Promise.all([fetchConfig(), fetchDefaultConfig()]);
            if (cfgRes) {
                setConfig(cfgRes as ConfigPayload);
                setSavedConfig(cfgRes as ConfigPayload);
            }
            if (defRes) {
                setDefaultConfig(defRes as ConfigPayload);
            }
        } catch {
            toast.error("读取配置失败");
        }
    }

    useEffect(() => {
        setLoading(true);
        void loadConfig().finally(() => setLoading(false));
    }, []);

    async function handleReload() {
        setReloading(true);
        try {
            await loadConfig();
            toast.success("配置已重新读取");
        } catch {
            toast.error("重新读取失败");
        } finally {
            setReloading(false);
        }
    }

    function restoreDefaults() {
        setConfig(defaultConfig);
        toast.info("已恢复默认配置（未保存）");
    }

    async function saveConfig() {
        setSaving(true);
        try {
            const res = await updateConfig(config);
            if (res) {
                setSavedConfig(res as ConfigPayload);
                setConfig(res as ConfigPayload);
            }
            clearCachedSyncStatus();
            toast.success("配置已保存");
        } catch {
            toast.error("保存配置失败");
        } finally {
            setSaving(false);
        }
    }

    function setSection<K extends keyof ConfigPayload>(
        section: K,
        patch: Partial<NonNullable<ConfigPayload[K]>>,
    ) {
        setConfig((prev) => ({
            ...prev,
            [section]: { ...(prev[section] as object), ...patch },
        }));
    }

    const imageMode: ImageProviderMode =
        (config.image as { mode?: ImageProviderMode } | undefined)?.mode ?? "studio";

    return (
        <section className="h-full overflow-y-auto">
            <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-1 py-1">
                <div className="rounded-[30px] border border-stone-200 bg-white px-5 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-start gap-4">
                                <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
                                    <Settings2 className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold tracking-tight text-stone-950">配置管理</h1>
                                    <p className="mt-2 max-w-[820px] text-sm leading-7 text-stone-500">
                                        所有字段都先在页面本地编辑，只有点击“保存配置”后才会写入
                                        <span className="mx-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">data/eidos.db</span>
                                        的 SQLite 配置表，并立即在后端生效。
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full border-stone-200 bg-white px-3 text-[13px] text-stone-700 shadow-none"
                                onClick={() => void handleReload()}
                                disabled={loading || reloading || saving}
                            >
                                {reloading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                                重新读取
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full border-stone-200 bg-white px-3 text-[13px] text-stone-700 shadow-none"
                                onClick={restoreDefaults}
                                disabled={loading || saving}
                            >
                                <RefreshCcw className="size-4" />
                                恢复默认
                            </Button>
                            <Button
                                type="button"
                                className="h-10 rounded-full bg-stone-950 px-3 text-[13px] text-white hover:bg-stone-800"
                                onClick={() => void saveConfig()}
                                disabled={loading || saving || !isDirty}
                            >
                                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                                保存配置
                            </Button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex flex-col gap-2.5">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-48 animate-pulse rounded-[28px] bg-stone-100" />
                        ))}
                    </div>
                ) : (
                    <>
                        <ConfigSection title="图片与接入">
                            <Field id="image-mode" label="图像模式" hint="studio=官方 Studio，cpa=代理模式，mix=自动混合">
                                <Select
                                    value={imageMode}
                                    onValueChange={(v) =>
                                        setConfig((prev) => ({
                                            ...prev,
                                            image: { ...(prev.image as object), mode: v as ImageProviderMode },
                                        }))
                                    }
                                >
                                    <SelectTrigger id="image-mode" className="h-11 w-full rounded-2xl border-stone-200 bg-white shadow-none focus-visible:ring-0">
                                        <SelectValue placeholder="选择图像模式" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="studio">Studio（官方）</SelectItem>
                                        <SelectItem value="cpa">CPA（代理）</SelectItem>
                                        <SelectItem value="mix">Mix（混合）</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>

                            <Field id="chatgpt-base-url" label="图像接口地址" hint="上游图像服务的基础 URL">
                                <Input
                                    id="chatgpt-base-url"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.chatgpt?.baseUrl ?? ""}
                                    onChange={(e) => setSection("chatgpt", { baseUrl: e.target.value })}
                                    placeholder="https://chatgpt.com"
                                />
                            </Field>

                            {/* CPA：接口地址 + 开关 同一行 */}
                            <div className="flex items-end gap-2 md:col-span-2">
                                <div className="flex-1">
                                    <LabelWithHint id="cpa-base-url" label="CPA 接口地址" hint="CPA 代理服务的基础 URL" />
                                    <Input
                                        id="cpa-base-url"
                                        className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                        value={config.cpa?.baseUrl ?? ""}
                                        onChange={(e) => setSection("cpa", { baseUrl: e.target.value })}
                                        placeholder="https://your-cpa-proxy.example.com"
                                        disabled={!config.cpa?.enabled}
                                    />
                                </div>
                                <div className="flex h-11 shrink-0 items-center gap-2.5 rounded-2xl border border-stone-200 bg-stone-50/70 px-4">
                                    <Checkbox
                                        id="cpa-enabled"
                                        checked={!!config.cpa?.enabled}
                                        onCheckedChange={(v) => setSection("cpa", { enabled: Boolean(v) })}
                                    />
                                    <label htmlFor="cpa-enabled" className="cursor-pointer text-sm font-medium text-stone-700 whitespace-nowrap">
                                        启用 CPA
                                    </label>
                                </div>
                            </div>

                            {/* CPA Management Key */}
                            <Field id="cpa-management-key" label="CPA Management Key" hint="CLIProxy 管理接口的鉴权密钥，用于 CPA 同步">
                                <Input
                                    id="cpa-management-key"
                                    type="password"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.cpa?.managementKey ?? ""}
                                    onChange={(e) => setSection("cpa", { managementKey: e.target.value })}
                                    placeholder="your-cliproxy-management-key"
                                    disabled={!config.cpa?.enabled}
                                />
                            </Field>

                            {/* 代理：地址 + 开关 同一行 */}
                            <div className="flex items-end gap-2 md:col-span-2">
                                <div className="flex-1">
                                    <LabelWithHint id="proxy-url" label="代理地址" hint="HTTP/HTTPS 代理 URL" />
                                    <Input
                                        id="proxy-url"
                                        className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                        value={(config.proxy as { enabled?: boolean; url?: string } | undefined)?.url ?? ""}
                                        onChange={(e) => setSection("proxy", { url: e.target.value })}
                                        placeholder="http://127.0.0.1:7890"
                                        disabled={!config.proxy?.enabled}
                                    />
                                </div>
                                <div className="flex h-11 shrink-0 items-center gap-2.5 rounded-2xl border border-stone-200 bg-stone-50/70 px-4">
                                    <Checkbox
                                        id="proxy-enabled"
                                        checked={!!config.proxy?.enabled}
                                        onCheckedChange={(v) => setSection("proxy", { enabled: Boolean(v) })}
                                    />
                                    <label htmlFor="proxy-enabled" className="cursor-pointer text-sm font-medium text-stone-700 whitespace-nowrap">
                                        启用代理
                                    </label>
                                </div>
                            </div>
                        </ConfigSection>

                        <ConfigSection title="运行与账号" description="服务监听、日志策略与账号认证/刷新配置。">
                            <Field id="server-host" label="监听主机" hint="服务器监听的主机地址">
                                <Input
                                    id="server-host"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.server?.host ?? ""}
                                    onChange={(e) => setSection("server", { host: e.target.value })}
                                    placeholder="0.0.0.0"
                                />
                            </Field>

                            <Field id="server-port" label="监听端口" hint="服务器监听的端口号">
                                <Input
                                    id="server-port"
                                    type="number"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.server?.port ?? 3000}
                                    onChange={(e) => setSection("server", { port: Number(e.target.value) })}
                                    placeholder="3000"
                                />
                            </Field>

                            <Field id="chatgpt-timeout" label="请求超时（ms）" hint="单次请求最大等待时间（毫秒）">
                                <Input
                                    id="chatgpt-timeout"
                                    type="number"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.chatgpt?.timeout ?? 60000}
                                    onChange={(e) => setSection("chatgpt", { timeout: Number(e.target.value) })}
                                    placeholder="60000"
                                />
                            </Field>

                            <Field id="log-level" label="日志级别" hint="输出日志的最低等级">
                                <Select
                                    value={(config.log as { level?: string; maxItems?: number } | undefined)?.level ?? "info"}
                                    onValueChange={(v) => setSection("log", { level: v })}
                                >
                                    <SelectTrigger id="log-level" className="h-11 w-full rounded-2xl border-stone-200 bg-white shadow-none focus-visible:ring-0">
                                        <SelectValue placeholder="选择日志级别" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="debug">debug</SelectItem>
                                        <SelectItem value="info">info</SelectItem>
                                        <SelectItem value="warn">warn</SelectItem>
                                        <SelectItem value="error">error</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>

                            <Field id="log-max-items" label="日志最大条数" hint="内存中保留的最大日志条目数">
                                <Input
                                    id="log-max-items"
                                    type="number"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={(config.log as { level?: string; maxItems?: number } | undefined)?.maxItems ?? 1000}
                                    onChange={(e) => setSection("log", { maxItems: Number(e.target.value) })}
                                    placeholder="1000"
                                />
                            </Field>

                            <Field id="app-auth-key" label="访问密钥 (AuthKey)" hint="保护管理界面的 API 密钥，留空则不鉴权">
                                <Input
                                    id="app-auth-key"
                                    type="password"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.app?.authKey ?? ""}
                                    onChange={(e) => setSection("app", { authKey: e.target.value })}
                                    placeholder="留空则不鉴权"
                                />
                            </Field>

                            <Field id="accounts-default-quota" label="默认账号配额" hint="新账号的默认并发请求配额">
                                <Input
                                    id="accounts-default-quota"
                                    type="number"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.accounts?.defaultQuota ?? 5}
                                    onChange={(e) => setSection("accounts", { defaultQuota: Number(e.target.value) })}
                                    placeholder="5"
                                />
                            </Field>

                            <Field id="accounts-refresh-interval" label="刷新间隔（分钟）" hint="自动刷新账号状态的间隔时间">
                                <Input
                                    id="accounts-refresh-interval"
                                    type="number"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={config.accounts?.refreshInterval ?? 30}
                                    onChange={(e) => setSection("accounts", { refreshInterval: Number(e.target.value) })}
                                    placeholder="30"
                                    disabled={!config.accounts?.autoRefresh}
                                />
                            </Field>

                            <ToggleField
                                id="accounts-auto-refresh"
                                label="自动刷新账号状态"
                                hint="定期自动刷新账号配额和状态信息"
                                checked={!!config.accounts?.autoRefresh}
                                onCheckedChange={(v) => setSection("accounts", { autoRefresh: v })}
                            />
                        </ConfigSection>

                        <ConfigSection title="存储与路径" description="把持久化方式、落盘目录和只读运行信息收拢在一起，排查配置最终落点会更直观。">
                            <Field id="storage-type" label="存储类型" hint="账号数据的持久化存储方式">
                                <Select
                                    value={(config.storage as { type?: string; path?: string } | undefined)?.type ?? "local"}
                                    onValueChange={(v) => setSection("storage", { type: v })}
                                >
                                    <SelectTrigger id="storage-type" className="h-11 w-full rounded-2xl border-stone-200 bg-white shadow-none focus-visible:ring-0">
                                        <SelectValue placeholder="选择存储类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sqlite">SQLite（推荐）</SelectItem>
                                        <SelectItem value="json">JSON 文件</SelectItem>
                                        <SelectItem value="memory">内存（仅调试）</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>

                            <Field id="storage-path" label="存储路径" hint="本地文件存储的根目录路径">
                                <Input
                                    id="storage-path"
                                    className="h-11 rounded-2xl border-stone-200 bg-white shadow-none"
                                    value={(config.storage as { type?: string; path?: string } | undefined)?.path ?? ""}
                                    onChange={(e) => setSection("storage", { path: e.target.value })}
                                    placeholder="data/eidos.db"
                                />
                            </Field>

                            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-400">运行时路径</p>
                                <TooltipDetails
                                    items={[
                                        {
                                            label: "数据目录",
                                            value:
                                                String(
                                                    firstNonEmptyValue(
                                                        (config.paths as { data?: string; logs?: string } | undefined)?.data,
                                                        config.storage?.path,
                                                    ) ?? "—",
                                                ),
                                        },
                                        {
                                            label: "日志目录",
                                            value: String(
                                                firstNonEmptyValue((config.paths as { data?: string; logs?: string } | undefined)?.logs) ?? "—",
                                            ),
                                        },
                                        {
                                            label: "存储类型",
                                            value: String(
                                                firstNonEmptyValue((config.storage as { type?: string; path?: string } | undefined)?.type) ?? "local",
                                            ),
                                        },
                                    ]}
                                />
                            </div>

                            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-400">同步配置摘要</p>
                                <TooltipDetails
                                    items={[
                                        {
                                            label: "同步状态",
                                            value: config.sync?.enabled ? "已启用" : "已禁用",
                                        },
                                        {
                                            label: "同步提供商",
                                            value: String(
                                                firstNonEmptyValue(
                                                    (config.sync as { enabled?: boolean; provider?: string; interval?: number; direction?: string } | undefined)
                                                        ?.provider,
                                                ) ?? "未配置",
                                            ),
                                        },
                                        {
                                            label: "同步方向",
                                            value: String(firstNonEmptyValue(config.sync?.direction) ?? "both"),
                                        },
                                        {
                                            label: "同步间隔（秒）",
                                            value: String(
                                                firstNonEmptyValue(
                                                    (config.sync as { enabled?: boolean; provider?: string; interval?: number; direction?: string } | undefined)
                                                        ?.interval,
                                                ) ?? 300,
                                            ),
                                        },
                                    ]}
                                />
                            </div>
                        </ConfigSection>
                    </>
                )}
            </div>
        </section>
    );
}
