"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CircleHelp,
    LoaderCircle,
    RefreshCcw,
    Save,
} from "lucide-react";
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
import { fetchConfig, fetchDefaultConfig, updateConfig, type ConfigPayload, type ImageApiStyle } from "@/lib/api";
import { clearCachedSyncStatus } from "@/store/sync-status-cache";

function defaultConfigPayload(): ConfigPayload {
    return {
        chatgpt: {
            enabled: false,
            baseUrl: "https://api.openai.com/v1",
            apiKey: "",
            apiStyle: "v1",
            responsesModel: "gpt-5.5",
        },
        cpa: {
            enabled: false,
            baseUrl: "",
            managementKey: "",
            providerType: "codex",
        },
        proxy: {
            enabled: false,
            url: "",
        },
        accounts: {
            defaultQuota: 5,
            autoRefresh: false,
            refreshInterval: 30,
        },
        sync: {
            enabled: false,
            provider: "",
            direction: "both",
            interval: 300,
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
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-xs leading-6 text-stone-600 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] group-hover:block group-focus-within:block dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                {text}
            </span>
        </span>
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
        <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
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
        <Card className="border-stone-200/60 bg-white shadow-sm rounded-2xl dark:border-stone-700 dark:bg-stone-900">
            <CardContent className="px-5 py-4">
                <div className="mb-3">
                    <h2 className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h2>
                    {description ? <p className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{description}</p> : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2">{children}</div>
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
        <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 md:col-span-2 dark:border-stone-700 dark:bg-stone-800/50">
            <div className="flex items-center gap-2.5">
                <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
                <div className="min-w-0">
                    <label htmlFor={id} className="text-sm font-medium text-stone-700 dark:text-stone-300">
                        {label}
                    </label>
                    {hint ? <p className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{hint}</p> : null}
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const [config, setConfig] = useState<ConfigPayload>(defaultConfigPayload());
    const [savedConfig, setSavedConfig] = useState<ConfigPayload>(defaultConfigPayload());
    const [defaultConfig, setDefaultConfig] = useState<ConfigPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [restoringDefaults, setRestoringDefaults] = useState(false);

    const isDirty = useMemo(
        () => JSON.stringify(config) !== JSON.stringify(savedConfig),
        [config, savedConfig],
    );

    async function loadCurrentConfig() {
        try {
            const cfgRes = await fetchConfig();
            if (cfgRes) {
                setConfig(cfgRes as ConfigPayload);
                setSavedConfig(cfgRes as ConfigPayload);
            }
        } catch {
            toast.error("读取配置失败");
        }
    }

    async function loadDefaultConfig(options?: { suppressError?: boolean }) {
        try {
            const defRes = await fetchDefaultConfig();
            if (defRes) {
                setDefaultConfig(defRes as ConfigPayload);
                return defRes as ConfigPayload;
            }
        } catch {
            if (!options?.suppressError) {
                toast.error("读取默认配置失败");
            }
        }
        return null;
    }

    useEffect(() => {
        setLoading(true);
        void loadCurrentConfig().finally(() => setLoading(false));
    }, []);

    async function restoreDefaults() {
        setRestoringDefaults(true);
        try {
            const nextDefaults = defaultConfig ?? await loadDefaultConfig();
            if (!nextDefaults) {
                return;
            }
            setConfig(nextDefaults);
            toast.info("已恢复默认配置（未保存）");
        } finally {
            setRestoringDefaults(false);
        }
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

    return (
        <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-[30px] border border-stone-200 bg-[#fcfcfb] px-4 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:px-5 sm:py-6 lg:px-6 lg:py-7 dark:border-stone-700 dark:bg-stone-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300" />
                    <div className="flex-1 -translate-y-[10px]">
                        <h1 className="text-[28px] font-bold tracking-tight text-stone-950 dark:text-stone-50">配置管理</h1>
                        <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">管理系统配置与服务参数</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-full border-stone-300/60 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
                        onClick={() => void restoreDefaults()}
                        disabled={loading || saving || restoringDefaults}
                    >
                        {restoringDefaults ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                        恢复默认
                    </Button>
                    <Button
                        type="button"
                        className="h-9 rounded-full bg-gradient-to-b from-stone-900 to-stone-800 px-4 text-sm font-medium text-white shadow-md transition-all hover:shadow-lg dark:from-stone-100 dark:to-stone-200 dark:text-stone-900"
                        onClick={() => void saveConfig()}
                        disabled={loading || saving || !isDirty}
                    >
                        {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                        保存
                    </Button>
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
                            <div className="flex items-end gap-2 md:col-span-2">
                                <div className="flex-1">
                                    <LabelWithHint id="chatgpt-base-url" label="图像 API 地址" hint="地址和 Key 可以预先填写；只有勾选启用后，图片生成/编辑/放大才会只走 API 通道" />
                                    <div className="relative">
                                        <Input
                                            id="chatgpt-base-url"
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-[104px] shadow-none"
                                            value={config.chatgpt?.baseUrl ?? ""}
                                            onChange={(e) => setSection("chatgpt", { baseUrl: e.target.value })}
                                            placeholder="https://api.openai.com/v1"
                                        />
                                        <label
                                            htmlFor="chatgpt-enabled"
                                            className="absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700"
                                        >
                                            <Checkbox
                                                id="chatgpt-enabled"
                                                checked={!!config.chatgpt?.enabled}
                                                onCheckedChange={(v) => setSection("chatgpt", { enabled: Boolean(v) })}
                                            />
                                            <span className="whitespace-nowrap">启用</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <LabelWithHint id="chatgpt-api-key" label="图像 API Key" hint="启用后所有图片请求都只走这里配置的 API，不再回退账号池" />
                                    <Input
                                        id="chatgpt-api-key"
                                        type="password"
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none"
                                        value={config.chatgpt?.apiKey ?? ""}
                                        onChange={(e) => setSection("chatgpt", { apiKey: e.target.value })}
                                        placeholder="sk-..."
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                                <Field
                                    id="chatgpt-api-style"
                                    label="图像 API 风格"
                                    hint="启用后：v1 Images 走 /v1/images/*；Responses 走 /v1/responses + image_generation 工具"
                                >
                                    <Select
                                        value={String(config.chatgpt?.apiStyle || "v1")}
                                        onValueChange={(value) => setSection("chatgpt", { apiStyle: value as ImageApiStyle })}
                                    >
                                        <SelectTrigger id="chatgpt-api-style" className="h-9 rounded-xl border-stone-200 bg-white shadow-none">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="v1">v1 Images 风格</SelectItem>
                                            <SelectItem value="responses">Responses 风格</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>

                                <Field
                                    id="chatgpt-responses-model"
                                    label="Responses 主模型"
                                    hint="仅在 Responses 风格下使用；官方推荐使用支持 image_generation 工具的响应模型"
                                >
                                    <Input
                                        id="chatgpt-responses-model"
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none"
                                        value={String(config.chatgpt?.responsesModel ?? "gpt-5.5")}
                                        onChange={(e) => setSection("chatgpt", { responsesModel: e.target.value })}
                                        placeholder="gpt-5.5"
                                        disabled={config.chatgpt?.apiStyle !== "responses"}
                                    />
                                </Field>
                            </div>

                            {/* CPA：接口地址 + Management Key + 开关 同一行 */}
                            <div className="flex items-end gap-2 md:col-span-2">
                                <div className="flex-1">
                                    <LabelWithHint id="cpa-base-url" label="CPA 接口地址" hint="CPA 代理服务的基础 URL" />
                                    <div className="relative">
                                        <Input
                                            id="cpa-base-url"
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-[104px] shadow-none"
                                            value={config.cpa?.baseUrl ?? ""}
                                            onChange={(e) => setSection("cpa", { baseUrl: e.target.value })}
                                            placeholder="https://your-cpa-proxy.example.com"
                                            disabled={!config.cpa?.enabled}
                                        />
                                        <label
                                            htmlFor="cpa-enabled"
                                            className="absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700"
                                        >
                                            <Checkbox
                                                id="cpa-enabled"
                                                checked={!!config.cpa?.enabled}
                                                onCheckedChange={(v) => setSection("cpa", { enabled: Boolean(v) })}
                                            />
                                            <span className="whitespace-nowrap">启用</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <LabelWithHint id="cpa-management-key" label="CPA Management Key" hint="CLIProxy 管理接口的鉴权密钥，用于 CPA 同步" />
                                    <Input
                                        id="cpa-management-key"
                                        type="password"
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none"
                                        value={config.cpa?.managementKey ?? ""}
                                        onChange={(e) => setSection("cpa", { managementKey: e.target.value })}
                                        placeholder="your-cliproxy-management-key"
                                        disabled={!config.cpa?.enabled}
                                    />
                                </div>
                            </div>

                            {/* 代理：地址 + 开关 同一行 */}
                            <div className="flex items-end gap-2 md:col-span-2">
                                <div className="flex-1">
                                    <LabelWithHint id="proxy-url" label="代理地址" hint="HTTP/HTTPS 代理 URL" />
                                    <div className="relative">
                                        <Input
                                            id="proxy-url"
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-[116px] shadow-none"
                                            value={(config.proxy as { enabled?: boolean; url?: string } | undefined)?.url ?? ""}
                                            onChange={(e) => setSection("proxy", { url: e.target.value })}
                                            placeholder="http://127.0.0.1:7890"
                                            disabled={!config.proxy?.enabled}
                                        />
                                        <label
                                            htmlFor="proxy-enabled"
                                            className="absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700"
                                        >
                                            <Checkbox
                                                id="proxy-enabled"
                                                checked={!!config.proxy?.enabled}
                                                onCheckedChange={(v) => setSection("proxy", { enabled: Boolean(v) })}
                                            />
                                            <span className="whitespace-nowrap">启用代理</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </ConfigSection>

                        <ConfigSection title="账号" description="账号池默认配额与自动刷新策略。">
                            <Field id="accounts-default-quota" label="默认账号配额" hint="新账号的默认并发请求配额">
                                <Input
                                    id="accounts-default-quota"
                                    type="number"
                                    className="h-9 rounded-xl border-stone-200 bg-white shadow-none"
                                    value={config.accounts?.defaultQuota ?? 5}
                                    onChange={(e) => setSection("accounts", { defaultQuota: Number(e.target.value) })}
                                    placeholder="5"
                                />
                            </Field>

                            <Field id="accounts-refresh-interval" label="刷新间隔（分钟）" hint="自动刷新账号状态的间隔时间">
                                <Input
                                    id="accounts-refresh-interval"
                                    type="number"
                                    className="h-9 rounded-xl border-stone-200 bg-white shadow-none"
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

                    </>
                )}
        </div>
    );
}
