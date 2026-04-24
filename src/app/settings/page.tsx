"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CircleHelp,
    LoaderCircle,
    RefreshCcw,
    RefreshCw,
    Save,
    Settings2,
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
import {
    fetchConfig,
    fetchDefaultConfig,
    updateConfig,
    type ConfigPayload,
    type ImageProviderMode,
} from "@/lib/api";
import { clearCachedSyncStatus } from "@/store/sync-status-cache";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function joinDisplayPath(...parts: (string | undefined | null)[]): string {
    return parts.filter(Boolean).join(" / ");
}

function firstNonEmptyValue<T>(...values: (T | undefined | null)[]): T | undefined {
    for (const v of values) {
        if (v !== undefined && v !== null && v !== ("" as unknown as T)) {
            return v;
        }
    }
    return undefined;
}

function defaultConfigPayload(): ConfigPayload {
    return {
        app: { authKey: "" },
        server: { port: 3000, host: "0.0.0.0" },
        chatgpt: { baseUrl: "https://chatgpt.com", timeout: 60000 },
        accounts: { defaultQuota: 5, autoRefresh: true, refreshInterval: 30 },
        storage: { type: "local", path: "./data" },
        sync: { enabled: false, provider: "", interval: 300, direction: "both" },
        proxy: { enabled: false, url: "" },
        cpa: { enabled: false, baseUrl: "" },
        log: { level: "info", maxItems: 1000 },
        paths: { data: "./data", logs: "./logs" },
    };
}

// ─── 内部子组件 ───────────────────────────────────────────────────────────────

function HintTooltip({ text }: { text: string }) {
    const [visible, setVisible] = useState(false);
    return (
        <span className="relative inline-flex items-center">
            <CircleHelp
                className="size-3.5 text-stone-400 hover:text-stone-600 cursor-pointer transition-colors"
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
            />
            {visible && (
                <span className="absolute left-5 top-0 z-50 w-56 rounded-md bg-stone-800 px-2.5 py-1.5 text-xs text-stone-100 shadow-lg">
                    {text}
                </span>
            )}
        </span>
    );
}

function TooltipDetails({ items }: { items: { label: string; value: string }[] }) {
    return (
        <dl className="mt-1 space-y-0.5 text-xs text-stone-500">
            {items.map(({ label, value }) => (
                <div key={label} className="flex gap-1">
                    <dt className="font-medium text-stone-600">{label}:</dt>
                    <dd className="font-mono break-all">{value || "—"}</dd>
                </div>
            ))}
        </dl>
    );
}

function LabelWithHint({
    label,
    hint,
    htmlFor,
}: {
    label: string;
    hint?: string;
    htmlFor?: string;
}) {
    return (
        <label
            htmlFor={htmlFor}
            className="flex items-center gap-1.5 text-sm font-medium text-stone-700"
        >
            {label}
            {hint && <HintTooltip text={hint} />}
        </label>
    );
}

function ConfigSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <Card className="border-stone-200 shadow-sm rounded-xl">
            <CardContent className="pt-5 pb-6 px-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-stone-800 border-b border-stone-100 pb-2">
                    <Settings2 className="size-4 text-stone-400" />
                    {title}
                </h3>
                <div className="space-y-4">{children}</div>
            </CardContent>
        </Card>
    );
}

function Field({
    label,
    hint,
    children,
    id,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
    id?: string;
}) {
    return (
        <div className="grid grid-cols-[1fr_2fr] items-center gap-4">
            <LabelWithHint label={label} hint={hint} htmlFor={id} />
            <div>{children}</div>
        </div>
    );
}

function ToggleField({
    label,
    hint,
    checked,
    onCheckedChange,
    id,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onCheckedChange: (val: boolean) => void;
    id: string;
}) {
    return (
        <div className="flex items-center gap-3">
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(v) => onCheckedChange(!!v)}
                className="rounded"
            />
            <LabelWithHint label={label} hint={hint} htmlFor={id} />
        </div>
    );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

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
        loadConfig().finally(() => setLoading(false));
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

    // 通用 setter 辅助函数
    function setSection<K extends keyof ConfigPayload>(
        section: K,
        patch: Partial<NonNullable<ConfigPayload[K]>>,
    ) {
        setConfig((prev) => ({
            ...prev,
            [section]: { ...(prev[section] as object), ...patch },
        }));
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center text-stone-400">
                <LoaderCircle className="size-6 animate-spin mr-2" />
                <span className="text-sm">加载配置中…</span>
            </div>
        );
    }

    const imageMode: ImageProviderMode =
        (config.image as { mode?: ImageProviderMode } | undefined)?.mode ?? "studio";

    return (
        <div className="min-h-screen bg-stone-50 p-6">
            <div className="mx-auto max-w-3xl space-y-6">
                {/* 页面标题 + 操作栏 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Settings2 className="size-5 text-stone-600" />
                        <h1 className="text-xl font-semibold text-stone-800">配置管理</h1>
                        {isDirty && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                                未保存
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-stone-600 hover:text-stone-800"
                            onClick={handleReload}
                            disabled={reloading || saving}
                        >
                            {reloading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <RefreshCw className="size-4" />
                            )}
                            重新读取
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-stone-300 text-stone-600 hover:text-stone-800"
                            onClick={restoreDefaults}
                            disabled={saving}
                        >
                            <RefreshCcw className="size-4" />
                            恢复默认
                        </Button>
                        <Button
                            size="sm"
                            className="gap-1.5 bg-stone-800 text-white hover:bg-stone-700"
                            onClick={saveConfig}
                            disabled={saving || !isDirty}
                        >
                            {saving ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Save className="size-4" />
                            )}
                            保存配置
                        </Button>
                    </div>
                </div>

                {/* ── Section 1: 图片模式 ── */}
                <ConfigSection title="图片模式">
                    <Field
                        id="image-mode"
                        label="图像模式"
                        hint="studio=官方 Studio，cpa=代理模式，mix=自动混合"
                    >
                        <Select
                            value={imageMode}
                            onValueChange={(v) =>
                                setConfig((prev) => ({
                                    ...prev,
                                    image: { ...(prev.image as object), mode: v as ImageProviderMode },
                                }))
                            }
                        >
                            <SelectTrigger id="image-mode" className="w-full border-stone-300">
                                <SelectValue placeholder="选择图像模式" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="studio">Studio（官方）</SelectItem>
                                <SelectItem value="cpa">CPA（代理）</SelectItem>
                                <SelectItem value="mix">Mix（混合）</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field id="chatgpt-base-url" label="ChatGPT 接口地址" hint="ChatGPT 服务的基础 URL">
                        <Input
                            id="chatgpt-base-url"
                            className="border-stone-300"
                            value={config.chatgpt?.baseUrl ?? ""}
                            onChange={(e) => setSection("chatgpt", { baseUrl: e.target.value })}
                            placeholder="https://chatgpt.com"
                        />
                    </Field>

                    <Field id="chatgpt-timeout" label="请求超时（ms）" hint="单次请求最大等待时间（毫秒）">
                        <Input
                            id="chatgpt-timeout"
                            type="number"
                            className="border-stone-300"
                            value={config.chatgpt?.timeout ?? 60000}
                            onChange={(e) =>
                                setSection("chatgpt", { timeout: Number(e.target.value) })
                            }
                            placeholder="60000"
                        />
                    </Field>
                </ConfigSection>

                {/* ── Section 2: CPA 配置 ── */}
                <ConfigSection title="CPA 配置">
                    <ToggleField
                        id="cpa-enabled"
                        label="启用 CPA 模式"
                        hint="是否启用 CPA（代理加速）路由"
                        checked={!!config.cpa?.enabled}
                        onCheckedChange={(v) => setSection("cpa", { enabled: v })}
                    />

                    <Field id="cpa-base-url" label="CPA 接口地址" hint="CPA 代理服务的基础 URL">
                        <Input
                            id="cpa-base-url"
                            className="border-stone-300"
                            value={(config.cpa as { enabled?: boolean; baseUrl?: string } | undefined)?.baseUrl ?? ""}
                            onChange={(e) => setSection("cpa", { baseUrl: e.target.value })}
                            placeholder="https://your-cpa-proxy.example.com"
                            disabled={!config.cpa?.enabled}
                        />
                    </Field>

                    <ToggleField
                        id="proxy-enabled"
                        label="启用代理"
                        hint="是否通过 HTTP 代理转发请求"
                        checked={!!config.proxy?.enabled}
                        onCheckedChange={(v) => setSection("proxy", { enabled: v })}
                    />

                    <Field id="proxy-url" label="代理地址" hint="HTTP/HTTPS 代理 URL">
                        <Input
                            id="proxy-url"
                            className="border-stone-300"
                            value={(config.proxy as { enabled?: boolean; url?: string } | undefined)?.url ?? ""}
                            onChange={(e) => setSection("proxy", { url: e.target.value })}
                            placeholder="http://127.0.0.1:7890"
                            disabled={!config.proxy?.enabled}
                        />
                    </Field>
                </ConfigSection>

                {/* ── Section 3: 基础运行配置 ── */}
                <ConfigSection title="基础运行配置">
                    <Field id="server-host" label="监听主机" hint="服务器监听的主机地址">
                        <Input
                            id="server-host"
                            className="border-stone-300"
                            value={config.server?.host ?? ""}
                            onChange={(e) => setSection("server", { host: e.target.value })}
                            placeholder="0.0.0.0"
                        />
                    </Field>

                    <Field id="server-port" label="监听端口" hint="服务器监听的端口号">
                        <Input
                            id="server-port"
                            type="number"
                            className="border-stone-300"
                            value={config.server?.port ?? 3000}
                            onChange={(e) =>
                                setSection("server", { port: Number(e.target.value) })
                            }
                            placeholder="3000"
                        />
                    </Field>

                    <Field id="log-level" label="日志级别" hint="输出日志的最低等级">
                        <Select
                            value={(config.log as { level?: string; maxItems?: number } | undefined)?.level ?? "info"}
                            onValueChange={(v) => setSection("log", { level: v })}
                        >
                            <SelectTrigger id="log-level" className="w-full border-stone-300">
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
                            className="border-stone-300"
                            value={(config.log as { level?: string; maxItems?: number } | undefined)?.maxItems ?? 1000}
                            onChange={(e) => setSection("log", { maxItems: Number(e.target.value) })}
                            placeholder="1000"
                        />
                    </Field>
                </ConfigSection>

                {/* ── Section 4: 账号与存储配置 ── */}
                <ConfigSection title="账号与存储配置">
                    <Field
                        id="app-auth-key"
                        label="访问密钥 (AuthKey)"
                        hint="保护管理界面的 API 密钥，留空则不鉴权"
                    >
                        <Input
                            id="app-auth-key"
                            type="password"
                            className="border-stone-300"
                            value={config.app?.authKey ?? ""}
                            onChange={(e) => setSection("app", { authKey: e.target.value })}
                            placeholder="留空则不鉴权"
                        />
                    </Field>

                    <Field id="accounts-default-quota" label="默认账号配额" hint="新账号的默认并发请求配额">
                        <Input
                            id="accounts-default-quota"
                            type="number"
                            className="border-stone-300"
                            value={config.accounts?.defaultQuota ?? 5}
                            onChange={(e) =>
                                setSection("accounts", { defaultQuota: Number(e.target.value) })
                            }
                            placeholder="5"
                        />
                    </Field>

                    <ToggleField
                        id="accounts-auto-refresh"
                        label="自动刷新账号状态"
                        hint="定期自动刷新账号配额和状态信息"
                        checked={!!config.accounts?.autoRefresh}
                        onCheckedChange={(v) => setSection("accounts", { autoRefresh: v })}
                    />

                    <Field
                        id="accounts-refresh-interval"
                        label="刷新间隔（分钟）"
                        hint="自动刷新账号状态的间隔时间"
                    >
                        <Input
                            id="accounts-refresh-interval"
                            type="number"
                            className="border-stone-300"
                            value={config.accounts?.refreshInterval ?? 30}
                            onChange={(e) =>
                                setSection("accounts", { refreshInterval: Number(e.target.value) })
                            }
                            placeholder="30"
                            disabled={!config.accounts?.autoRefresh}
                        />
                    </Field>

                    <Field id="storage-type" label="存储类型" hint="账号数据的持久化存储方式">
                        <Select
                            value={(config.storage as { type?: string; path?: string } | undefined)?.type ?? "local"}
                            onValueChange={(v) => setSection("storage", { type: v })}
                        >
                            <SelectTrigger id="storage-type" className="w-full border-stone-300">
                                <SelectValue placeholder="选择存储类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="local">本地文件（local）</SelectItem>
                                <SelectItem value="sqlite">SQLite</SelectItem>
                                <SelectItem value="memory">内存（memory）</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field id="storage-path" label="存储路径" hint="本地文件存储的根目录路径">
                        <Input
                            id="storage-path"
                            className="border-stone-300"
                            value={(config.storage as { type?: string; path?: string } | undefined)?.path ?? ""}
                            onChange={(e) => setSection("storage", { path: e.target.value })}
                            placeholder="./data"
                        />
                    </Field>
                </ConfigSection>

                {/* ── Section 5: 路径信息（只读）── */}
                <ConfigSection title="路径信息（只读）">
                    <div className="rounded-lg bg-stone-50 border border-stone-200 p-4 space-y-2">
                        <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">
                            运行时路径（由系统自动解析，不可手动修改）
                        </p>
                        <TooltipDetails
                            items={[
                                {
                                    label: "数据目录",
                                    value:
                                        firstNonEmptyValue(
                                            (config.paths as { data?: string; logs?: string } | undefined)?.data,
                                            config.storage?.path,
                                        ) ?? "—",
                                },
                                {
                                    label: "日志目录",
                                    value:
                                        firstNonEmptyValue(
                                            (config.paths as { data?: string; logs?: string } | undefined)?.logs,
                                        ) ?? "—",
                                },
                                {
                                    label: "完整路径",
                                    value: joinDisplayPath(
                                        (config.paths as { data?: string; logs?: string } | undefined)?.data,
                                        (config.paths as { data?: string; logs?: string } | undefined)?.logs,
                                    ) || "—",
                                },
                                {
                                    label: "存储类型",
                                    value:
                                        firstNonEmptyValue(
                                            (config.storage as { type?: string; path?: string } | undefined)?.type,
                                        ) ?? "local",
                                },
                            ]}
                        />
                    </div>

                    <div className="rounded-lg bg-stone-50 border border-stone-200 p-4">
                        <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">
                            同步配置摘要
                        </p>
                        <TooltipDetails
                            items={[
                                {
                                    label: "同步状态",
                                    value: config.sync?.enabled ? "已启用" : "已禁用",
                                },
                                {
                                    label: "同步提供商",
                                    value:
                                        firstNonEmptyValue(
                                            (config.sync as { enabled?: boolean; provider?: string; interval?: number; direction?: string } | undefined)?.provider,
                                        ) ?? "未配置",
                                },
                                {
                                    label: "同步方向",
                                    value:
                                        firstNonEmptyValue(
                                            config.sync?.direction,
                                        ) ?? "both",
                                },
                                {
                                    label: "同步间隔（秒）",
                                    value: String(
                                        firstNonEmptyValue(
                                            (config.sync as { enabled?: boolean; provider?: string; interval?: number; direction?: string } | undefined)?.interval,
                                        ) ?? 300,
                                    ),
                                },
                            ]}
                        />
                    </div>
                </ConfigSection>
            </div>
        </div>
    );
}
