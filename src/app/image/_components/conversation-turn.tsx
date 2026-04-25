"use client";

import {
    AlertCircle,
    Brush,
    Clock3,
    Copy,
    ImageIcon,
    LoaderCircle,
    RotateCcw,
    Sparkles,
    ZoomIn,
    Download,
} from "lucide-react";

import { AppImage as Image } from "@/components/app-image";
import { cn } from "@/lib/utils";
import type { ImageConversationTurn, ImageMode, StoredImage, StoredSourceImage } from "@/store/image-conversations";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatConversationTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function buildConversationSourceLabel(source: StoredSourceImage) {
    return source.role === "mask" ? "选区 / 遮罩" : "源图";
}

function buildImageDataUrl(image: StoredImage) {
    if (image.url) return image.url;
    if (!image.b64_json) return "";
    return `data:image/png;base64,${image.b64_json}`;
}

function formatProcessingDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const modeLabelMap: Record<ImageMode, string> = {
    generate: "生成",
    edit: "编辑",
    upscale: "放大",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type ConversationTurnProps = {
    turn: ImageConversationTurn;
    conversationId: string;
    /** 该 turn 是否正在处理中 */
    isProcessing: boolean;
    processingStatus: { title: string; detail: string } | null;
    waitingDots: string;
    submitElapsedSeconds: number;
    isSubmitting: boolean;
    onOpenImageInNewTab: (dataUrl: string) => void;
    onOpenSelectionEditor: (conversationId: string, turnId: string, image: StoredImage, imageName: string) => void;
    onSeedFromResult: (conversationId: string, image: StoredImage, nextMode: ImageMode) => void;
    onRetryTurn: (conversationId: string, turn: ImageConversationTurn) => void;
};

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export function ConversationTurn({
    turn,
    conversationId,
    isProcessing,
    processingStatus,
    waitingDots,
    submitElapsedSeconds,
    isSubmitting,
    onOpenImageInNewTab,
    onOpenSelectionEditor,
    onSeedFromResult,
    onRetryTurn,
}: ConversationTurnProps) {
    return (
        <div className="space-y-4">
            {/* 用户消息 */}
            <div className="flex justify-end">
                <div className="flex w-full max-w-[94%] flex-col items-end gap-3">
                    {turn.sourceImages && turn.sourceImages.filter((s) => !s.hiddenInConversation).length > 0 ? (
                        <div className="flex flex-wrap justify-end gap-2.5">
                            {turn.sourceImages.filter((s) => !s.hiddenInConversation).map((source) => (
                                <div
                                    key={source.id}
                                    className="w-[136px] overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-sm"
                                >
                                    <div className="border-b border-stone-100 px-3 py-2 text-left text-[11px] font-medium text-stone-500">
                                        {buildConversationSourceLabel(source)}
                                    </div>
                                    <button
                                        type="button"
                                        className="block w-full cursor-zoom-in"
                                        onClick={() => onOpenImageInNewTab(source.dataUrl)}
                                    >
                                        <Image
                                            src={source.dataUrl}
                                            alt={source.name}
                                            className="block h-24 w-full bg-stone-50 object-contain"
                                        />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="max-w-full rounded-[16px] bg-[#f2f2f1] px-3 py-2.5 text-[15px] leading-7 text-stone-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                        {turn.prompt || "无额外提示词"}
                    </div>
                </div>
            </div>

            {/* AI 响应 */}
            <div className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                    <span className="flex size-9 items-center justify-center rounded-2xl bg-stone-950 text-white">
                        <Sparkles className="size-4" />
                    </span>
                    <div className="flex flex-col gap-0.5">
                        <div className="text-sm font-semibold tracking-tight text-stone-900">Eidos</div>
                        <div className="flex items-center gap-2 text-[11px] text-stone-400">
                            <span>{turn.model}</span>
                            <span className="text-stone-300">·</span>
                            <span className="flex items-center gap-0.5">
                                <Clock3 className="size-3" />
                                {formatConversationTime(turn.createdAt)}
                            </span>
                        </div>
                    </div>
                </div>

                {turn.images.length > 0 ? (
                    <div
                        className={cn(
                            "grid gap-3",
                            turn.images.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
                        )}
                    >
                        {turn.images.map((image, index) => (
                            <div
                                key={image.id}
                                className={cn(
                                    "overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-sm",
                                    turn.images.length === 1 && "w-fit max-w-full justify-self-start",
                                )}
                            >
                                {image.status === "success" && image.text ? (
                                    /* ── 纯文字回复态 ── */
                                    <div className="flex max-w-[320px] flex-col gap-2 px-4 py-3.5">
                                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
                                            <Sparkles className="size-3" />
                                            AI 回复
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">{image.text}</p>
                                    </div>
                                ) : image.status === "success" && (image.url || image.b64_json) ? (
                                    <div className="group relative">
                                        <button
                                            type="button"
                                            className="block w-full cursor-zoom-in"
                                            onClick={() => onOpenImageInNewTab(buildImageDataUrl(image))}
                                        >
                                            <Image
                                                src={buildImageDataUrl(image)}
                                                alt={`Generated result ${index + 1}`}
                                                className="block h-auto max-h-[360px] w-auto max-w-full"
                                            />
                                        </button>
                                        {/* hover 浮层操作条 */}
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 rounded-b-[20px] bg-gradient-to-t from-black/50 to-transparent px-2.5 py-2 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
                                            <button
                                                type="button"
                                                className="inline-flex size-7 items-center justify-center rounded-lg text-white transition hover:bg-white/25 hover:text-white"
                                                onClick={() =>
                                                    onOpenSelectionEditor(
                                                        conversationId,
                                                        turn.id,
                                                        image,
                                                        `${turn.title || "image"}-${index + 1}.png`,
                                                    )
                                                }
                                                title="选区编辑"
                                            >
                                                <Brush className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="inline-flex size-7 items-center justify-center rounded-lg text-white transition hover:bg-white/25 hover:text-white"
                                                onClick={() => onSeedFromResult(conversationId, image, "edit")}
                                                title="继续编辑"
                                            >
                                                <Copy className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="inline-flex size-7 items-center justify-center rounded-lg text-white transition hover:bg-white/25 hover:text-white"
                                                onClick={() => onSeedFromResult(conversationId, image, "upscale")}
                                                title="放大"
                                            >
                                                <ZoomIn className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="ml-auto inline-flex size-7 items-center justify-center rounded-lg text-white transition hover:bg-white/25 hover:text-white"
                                                onClick={() => onOpenImageInNewTab(buildImageDataUrl(image))}
                                                title="查看原图"
                                            >
                                                <Download className="size-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ) : image.status === "error" ? (
                                    /* ── 错误态 ── */
                                    <div className="flex min-h-[240px] min-w-[240px] flex-col">
                                        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
                                            <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-50">
                                                <AlertCircle className="size-5 text-rose-500" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium text-rose-600">处理失败</p>
                                                <p className="line-clamp-3 max-w-[280px] text-xs leading-5 text-stone-500">
                                                    {image.error || "未知错误"}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="border-t border-stone-100 px-3 py-2.5">
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
                                                onClick={() => onRetryTurn(conversationId, turn)}
                                                disabled={isSubmitting}
                                                aria-label="重试"
                                            >
                                                <RotateCcw className={cn("size-3.5", isSubmitting && "animate-spin")} />
                                                {isSubmitting ? "处理中" : "重试"}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── 处理中态 ── */
                                    <div className="relative flex min-h-[240px] min-w-[240px] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,#f5f5f4,transparent_55%),linear-gradient(180deg,#fafaf9_0%,#ffffff_100%)] px-6 py-8 text-center">
                                        <div className="absolute inset-x-8 top-8 h-24 rounded-full bg-stone-200/40 blur-3xl" />
                                        <div className="absolute inset-0 opacity-60">
                                            <div className="absolute left-6 top-6 h-16 w-16 animate-pulse rounded-[20px] border border-stone-200/70 bg-white/80" />
                                            <div className="absolute right-8 top-12 h-10 w-10 animate-pulse rounded-[14px] border border-stone-200/60 bg-white/70 [animation-delay:300ms]" />
                                            <div className="absolute bottom-8 left-1/2 h-20 w-20 -translate-x-1/2 animate-pulse rounded-[24px] border border-stone-200/70 bg-white/80 [animation-delay:600ms]" />
                                        </div>
                                        <div className="relative z-10 flex flex-col items-center gap-4">
                                            <div className="relative">
                                                <div className="absolute inset-[-10px] rounded-[24px] border border-stone-200/70 animate-pulse" />
                                                <div className="relative flex size-16 items-center justify-center rounded-[22px] border border-stone-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                                                    <div className="absolute inset-2 rounded-[16px] bg-[linear-gradient(135deg,#fafaf9,#f1f5f9)]" />
                                                    <div className="relative flex items-center justify-center">
                                                        {isProcessing ? (
                                                            <LoaderCircle className="size-5 animate-spin text-stone-600" />
                                                        ) : (
                                                            <ImageIcon className="size-5 text-stone-400" />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                <p className="text-sm font-semibold text-stone-700">
                                                    {isProcessing && processingStatus
                                                        ? processingStatus.title
                                                        : "正在创建占位图…"}
                                                </p>
                                                <p className="text-xs leading-5 text-stone-400">
                                                    {isProcessing && processingStatus
                                                        ? processingStatus.detail
                                                        : "已接收请求，正在准备图像画布"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

