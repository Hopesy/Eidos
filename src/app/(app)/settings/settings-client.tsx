"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
    CircleHelp,
    Check,
    ChevronDown,
    Eye,
    EyeOff,
    LoaderCircle,
    RefreshCcw,
    Save,
    Zap,
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
import { useSettingsPage } from "@/features/settings/use-settings-page";
import type { ImageApiStyle, ImageOutputFormat, ResponsesReasoningEffort } from "@/lib/api";
import { fetchImageModels, testImageApi } from "@/lib/api/config";
import { DEFAULT_IMAGE_MODEL_IDS, normalizeImageModels, type ConfigPayload } from "@/shared/app-config";

const imageFormatOptions: Array<{ label: string; value: ImageOutputFormat }> = [
    { label: "PNG", value: "png" },
    { label: "JPEG", value: "jpeg" },
    { label: "WebP", value: "webp" },
];

const responsesReasoningEffortOptions: Array<{ label: string; value: ResponsesReasoningEffort }> = [
    { label: "默认", value: "default" },
    { label: "None", value: "none" },
    { label: "Minimal", value: "minimal" },
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "XHigh", value: "xhigh" },
];

function normalizeModelId(value: unknown) {
    return String(value || "").trim();
}

function getConfiguredImageModels(value: unknown) {
    return normalizeImageModels(value, DEFAULT_IMAGE_MODEL_IDS);
}

function mergeImageModels(models: string[], modelId: string) {
    const next = normalizeModelId(modelId);
    if (!next) {
        return models;
    }
    return [next, ...models.filter((item) => item !== next)];
}

function HintTooltip({ text }: { text: string }) {
    return (
        <span className="relative inline-flex items-center group">
            <CircleHelp
                className="size-4 text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                aria-hidden="true"
            />
            <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-stone-200 bg-white px-3 py-2 text-xs leading-6 text-stone-600 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] group-hover:block group-focus-within:block sm:left-1/2 sm:right-auto sm:-translate-x-1/2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
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
    children: ReactNode;
}) {
    return (
        <Card className="border-stone-200/60 bg-white shadow-sm rounded-2xl dark:border-stone-700 dark:bg-stone-900">
            <CardContent className="px-4 py-4 sm:px-5">
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
    children: ReactNode;
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
    children,
}: {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    children?: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 md:col-span-2 dark:border-stone-700 dark:bg-stone-800/50">
            <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:items-center md:gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
                    <div className="min-w-0">
                        <label htmlFor={id} className="text-sm font-medium text-stone-700 dark:text-stone-300">
                            {label}
                        </label>
                        {hint ? <p className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{hint}</p> : null}
                    </div>
                </div>
                {children ? <div className="min-w-0">{children}</div> : null}
            </div>
        </div>
    );
}

type SettingsClientProps = {
    initialConfig: ConfigPayload;
    initialDefaultConfig: ConfigPayload;
    saveConfigAction: (config: ConfigPayload) => Promise<ConfigPayload>;
};

export function SettingsClient({ initialConfig, initialDefaultConfig, saveConfigAction }: SettingsClientProps) {
    const [showChatgptApiKey, setShowChatgptApiKey] = useState(false);
    const [testingApi, setTestingApi] = useState(false);
    const [fetchingImageModels, setFetchingImageModels] = useState(false);
    const [imageModelMenuOpen, setImageModelMenuOpen] = useState(false);
    const [customImageModel, setCustomImageModel] = useState(() => getConfiguredImageModels(initialConfig.chatgpt?.imageModels)[0] || "gpt-image-2");
    const {
        config,
        loading,
        saving,
        restoringDefaults,
        isDirty,
        restoreDefaults,
        saveConfig,
        setSection,
    } = useSettingsPage({ initialConfig, initialDefaultConfig, saveConfigAction });

    async function handleTestApi() {
        const baseUrl = (config.chatgpt?.baseUrl ?? "").trim();
        const apiKey = (config.chatgpt?.apiKey ?? "").trim();
        if (!baseUrl) {
            toast.error("请先填写图像 API 地址");
            return;
        }
        if (!apiKey) {
            toast.error("请先填写图像 API Key");
            return;
        }
        setTestingApi(true);
        try {
            const result = await testImageApi({ baseUrl, apiKey });
            if (result.ok) {
                toast.success("API 配置正常", {
                    description: `连接通过，耗时 ${result.durationMs}ms`,
                });
            } else {
                toast.error("API 配置异常", {
                    description: result.hint || result.message,
                });
            }
        } catch (error) {
            toast.error("测试请求失败", {
                description: error instanceof Error ? error.message : "网络异常",
            });
        } finally {
            setTestingApi(false);
        }
    }

    async function handleRestoreDefaults() {
        await restoreDefaults();
        setCustomImageModel(getConfiguredImageModels(initialDefaultConfig.chatgpt?.imageModels)[0] || "gpt-image-2");
    }

    async function handleFetchImageModels() {
        const baseUrl = (config.chatgpt?.baseUrl ?? "").trim();
        const apiKey = (config.chatgpt?.apiKey ?? "").trim();
        if (!baseUrl) {
            toast.error("请先填写图像 API 地址");
            return;
        }
        if (!apiKey) {
            toast.error("请先填写图像 API Key");
            return;
        }
        setFetchingImageModels(true);
        try {
            const result = await fetchImageModels({ baseUrl, apiKey });
            const modelIds = normalizeImageModels(
                (Array.isArray(result.data) ? result.data : []).map((item) => item.id),
                [],
            );
            if (modelIds.length === 0) {
                toast.error("未从 /models 读取到可用模型 ID");
                return;
            }
            setCustomImageModel(modelIds[0] || "");
            setSection("chatgpt", { imageModels: modelIds });
            toast.success("模型列表已拉取", {
                description: `读取到 ${modelIds.length} 个模型，保存配置后生效`,
            });
        } catch (error) {
            toast.error("拉取模型列表失败", {
                description: error instanceof Error ? error.message : "网络异常",
            });
        } finally {
            setFetchingImageModels(false);
        }
    }

    const imageModels = getConfiguredImageModels(config.chatgpt?.imageModels);
    const selectedImageModel = normalizeModelId(customImageModel) || imageModels[0] || "gpt-image-2";

    function handleSelectImageModel(modelId: string) {
        const nextModels = mergeImageModels(imageModels, modelId);
        setCustomImageModel(modelId);
        setSection("chatgpt", { imageModels: nextModels });
        setImageModelMenuOpen(false);
    }

    function handleCustomImageModelBlur() {
        const modelId = normalizeModelId(customImageModel);
        if (modelId) {
            setSection("chatgpt", { imageModels: mergeImageModels(imageModels, modelId) });
        }
    }

    return (
        <div className="hide-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1 shadow-none sm:rounded-[30px] sm:border sm:border-stone-200 sm:bg-[#fcfcfb] sm:px-5 sm:py-6 sm:shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:px-6 lg:py-7 dark:sm:border-stone-700 dark:sm:bg-stone-950">
            <div className="hidden sm:flex sm:flex-col sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                    <div className="relative h-14 w-1.5 rounded-full bg-gradient-to-b from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300" />
                    <div className="flex-1 -translate-y-[10px]">
                        <h1 className="text-2xl font-bold tracking-tight text-stone-950 sm:text-[28px] dark:text-stone-50">配置管理</h1>
                        <p className="mt-1 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">管理系统配置与服务参数</p>
                    </div>
                </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-full border-stone-300/60 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
                        onClick={() => void handleRestoreDefaults()}
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
                        <div key={i} className="h-48 animate-pulse rounded-[28px] bg-stone-100 dark:bg-stone-800" />
                    ))}
                </div>
                ) : (
                    <>
                        <ConfigSection title="图片与接入">
                            <div className="grid gap-2 md:col-span-2 md:grid-cols-2 md:items-end xl:grid-cols-4">
                                <div className="md:col-span-2">
                                    <LabelWithHint id="chatgpt-base-url" label="图像 API 地址" hint="地址和 Key 可以预先填写；只有勾选启用后，图片生成/编辑/放大才会只走 API 通道" />
                                    <div className="relative">
                                        <Input
                                            id="chatgpt-base-url"
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-[170px] shadow-none dark:border-stone-700 dark:bg-stone-800"
                                            value={config.chatgpt?.baseUrl ?? ""}
                                            onChange={(e) => setSection("chatgpt", { baseUrl: e.target.value })}
                                            placeholder="https://api.openai.com/v1"
                                        />
                                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => void handleTestApi()}
                                                disabled={testingApi}
                                                className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                                                title="使用当前地址和 Key 测试连通性"
                                            >
                                                {testingApi ? <LoaderCircle className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                                                <span className="whitespace-nowrap">测试</span>
                                            </button>
                                            <label
                                                htmlFor="chatgpt-enabled"
                                                className="inline-flex h-6 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
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
                                </div>
                                <div>
                                    <LabelWithHint id="chatgpt-api-key" label="图像 API Key" hint="启用后所有图片请求都只走这里配置的 API，不再回退账号池" />
                                    <div className="relative">
                                        <Input
                                            id="chatgpt-api-key"
                                            type={showChatgptApiKey ? "text" : "password"}
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-10 shadow-none dark:border-stone-700 dark:bg-stone-800"
                                            value={config.chatgpt?.apiKey ?? ""}
                                            onChange={(e) => setSection("chatgpt", { apiKey: e.target.value })}
                                            placeholder="sk-..."
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                                            onClick={() => setShowChatgptApiKey((prev) => !prev)}
                                            aria-label={showChatgptApiKey ? "隐藏图像 API Key" : "显示图像 API Key"}
                                            aria-pressed={showChatgptApiKey}
                                            title={showChatgptApiKey ? "隐藏图像 API Key" : "显示图像 API Key"}
                                        >
                                            {showChatgptApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                        </Button>
                                    </div>
                                </div>
                                <div>
                                    <LabelWithHint id="chatgpt-image-model" label="图像模型" hint="选择保存到图像工作台的默认模型，也可在下拉内输入自定义模型 ID" />
                                    <div className="relative">
                                        <button
                                            id="chatgpt-image-model"
                                            type="button"
                                            className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 text-left text-sm text-stone-800 shadow-none transition-colors hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                                            onClick={() => setImageModelMenuOpen((prev) => !prev)}
                                        >
                                            <span className="min-w-0 truncate">{selectedImageModel}</span>
                                            <ChevronDown className="size-4 shrink-0 text-stone-400" />
                                        </button>
                                        {imageModelMenuOpen ? (
                                            <div className="absolute right-0 top-full z-30 mt-1 w-[300px] rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                                                <button
                                                    type="button"
                                                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-stone-300 dark:hover:bg-stone-800"
                                                    onClick={() => void handleFetchImageModels()}
                                                    disabled={fetchingImageModels}
                                                >
                                                    {fetchingImageModels ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
                                                    从 /models 拉取
                                                </button>
                                                <div className="my-1 h-px bg-stone-100 dark:bg-stone-800" />
                                                <div className="max-h-44 overflow-y-auto">
                                                    {imageModels.map((modelId) => (
                                                        <button
                                                            key={modelId}
                                                            type="button"
                                                            className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                                                            onClick={() => handleSelectImageModel(modelId)}
                                                        >
                                                            <span className="min-w-0 truncate">{modelId}</span>
                                                            {modelId === selectedImageModel ? <Check className="size-3.5 shrink-0" /> : null}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="mt-1 border-t border-stone-100 pt-1.5 dark:border-stone-800">
                                                    <Input
                                                        value={customImageModel}
                                                        onChange={(event) => setCustomImageModel(event.target.value)}
                                                        onBlur={handleCustomImageModelBlur}
                                                        onKeyDown={(event) => {
                                                            if (event.key === "Enter") {
                                                                event.preventDefault();
                                                                handleSelectImageModel(customImageModel);
                                                            }
                                                        }}
                                                        placeholder="自定义模型 ID"
                                                        className="h-8 rounded-lg border-stone-200 bg-white text-xs shadow-none dark:border-stone-700 dark:bg-stone-900"
                                                    />
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 md:col-span-2 dark:border-stone-700 dark:bg-stone-800/50">
                                <div className="flex flex-col gap-3">
                                    <div className="grid gap-3 md:grid-cols-2 md:items-end xl:grid-cols-4">
                                        <Field
                                            id="chatgpt-image-format"
                                            label="图片格式"
                                            hint="生成页只显示当前格式，修改后新任务使用这个输出格式"
                                        >
                                            <Select
                                                value={String(config.chatgpt?.imageFormat || "png")}
                                                onValueChange={(value) => setSection("chatgpt", { imageFormat: value as ImageOutputFormat })}
                                            >
                                                <SelectTrigger id="chatgpt-image-format" className="h-9 w-full rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {imageFormatOptions.map((item) => (
                                                        <SelectItem key={item.value} value={item.value}>
                                                            {item.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </Field>

                                        <Field
                                            id="chatgpt-api-style"
                                            label="图像 API 风格"
                                            hint="选择当前图像服务兼容的请求协议"
                                        >
                                            <Select
                                                value={String(config.chatgpt?.apiStyle || "v1")}
                                                onValueChange={(value) => setSection("chatgpt", { apiStyle: value as ImageApiStyle })}
                                                disabled={!config.chatgpt?.enabled}
                                            >
                                                <SelectTrigger id="chatgpt-api-style" className="h-9 w-full rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="v1">Images API</SelectItem>
                                                    <SelectItem value="responses">Responses API</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </Field>

                                        <Field
                                            id="chatgpt-responses-model"
                                            label="Responses 主模型"
                                            hint="仅在 Responses API 下使用"
                                        >
                                            <Input
                                                id="chatgpt-responses-model"
                                                className="h-9 rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900"
                                                value={String(config.chatgpt?.responsesModel ?? "gpt-5.5")}
                                                onChange={(e) => setSection("chatgpt", { responsesModel: e.target.value })}
                                                placeholder="gpt-5.5"
                                                disabled={!config.chatgpt?.enabled || config.chatgpt?.apiStyle !== "responses"}
                                            />
                                        </Field>

                                        <Field
                                            id="chatgpt-responses-reasoning-effort"
                                            label="推理强度"
                                            hint="仅在 Responses API 下使用；默认表示不向上游发送 reasoning.effort"
                                        >
                                            <Select
                                                value={String(config.chatgpt?.responsesReasoningEffort ?? "default")}
                                                onValueChange={(value) => setSection("chatgpt", { responsesReasoningEffort: value as ResponsesReasoningEffort })}
                                                disabled={!config.chatgpt?.enabled || config.chatgpt?.apiStyle !== "responses"}
                                            >
                                                <SelectTrigger id="chatgpt-responses-reasoning-effort" className="h-9 w-full rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {responsesReasoningEffortOptions.map((item) => (
                                                        <SelectItem key={item.value} value={item.value}>
                                                            {item.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                    </div>
                                </div>
                            </div>

                            {/* CPA：接口地址 + Management Key + 开关 同一行 */}
                            <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-end">
                                <div className="flex-1">
                                    <LabelWithHint id="cpa-base-url" label="CPA 接口地址" hint="CPA 代理服务的基础 URL" />
                                    <div className="relative">
                                        <Input
                                            id="cpa-base-url"
                                            className="h-9 rounded-xl border-stone-200 bg-white pr-[104px] shadow-none dark:border-stone-700 dark:bg-stone-800"
                                            value={config.cpa?.baseUrl ?? ""}
                                            onChange={(e) => setSection("cpa", { baseUrl: e.target.value })}
                                            placeholder="https://your-cpa-proxy.example.com"
                                            disabled={!config.cpa?.enabled}
                                        />
                                        <label
                                            htmlFor="cpa-enabled"
                                            className="absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
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
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-800"
                                        value={config.cpa?.managementKey ?? ""}
                                        onChange={(e) => setSection("cpa", { managementKey: e.target.value })}
                                        placeholder="your-cliproxy-management-key"
                                        disabled={!config.cpa?.enabled}
                                    />
                                </div>
                            </div>

                            <ToggleField
                                id="proxy-enabled"
                                label="启用代理"
                                hint="启用后请求会通过 HTTP/HTTPS 代理转发"
                                checked={!!config.proxy?.enabled}
                                onCheckedChange={(v) => setSection("proxy", { enabled: v })}
                            >
                                <Field id="proxy-url" label="代理地址" hint="HTTP/HTTPS 代理 URL">
                                    <Input
                                        id="proxy-url"
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900"
                                        value={(config.proxy as { enabled?: boolean; url?: string } | undefined)?.url ?? ""}
                                        onChange={(e) => setSection("proxy", { url: e.target.value })}
                                        placeholder="http://127.0.0.1:7890"
                                        disabled={!config.proxy?.enabled}
                                    />
                                </Field>
                            </ToggleField>
                        </ConfigSection>

                        <ConfigSection title="账号" description="账号池自动刷新策略。">
                            <ToggleField
                                id="accounts-auto-refresh"
                                label="自动刷新账号状态"
                                hint="定期自动刷新账号配额和状态信息"
                                checked={!!config.accounts?.autoRefresh}
                                onCheckedChange={(v) => setSection("accounts", { autoRefresh: v })}
                            >
                                <Field id="accounts-refresh-interval" label="刷新间隔（分钟）" hint="自动刷新账号状态的间隔时间">
                                    <Input
                                        id="accounts-refresh-interval"
                                        type="number"
                                        min={1}
                                        max={1440}
                                        step={1}
                                        className="h-9 rounded-xl border-stone-200 bg-white shadow-none dark:border-stone-700 dark:bg-stone-900"
                                        value={config.accounts?.refreshInterval ?? 30}
                                        onChange={(e) => setSection("accounts", { refreshInterval: Number(e.target.value) })}
                                        placeholder="30"
                                        disabled={!config.accounts?.autoRefresh}
                                    />
                                </Field>
                            </ToggleField>
                        </ConfigSection>

                    </>
                )}
        </div>
    );
}
