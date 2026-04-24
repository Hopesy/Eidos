"use client";

import {
    Brush,
    Clock3,
    Copy,
    LoaderCircle,
    RotateCcw,
    Sparkles,
    ZoomIn,
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
                <div className="flex w-full max-w-[78%] flex-col items-end gap-4">
                    {turn.sourceImages && turn.sourceImages.length > 0 ? (
                        <div className="flex flex-wrap justify-end gap-2.5">
                            {turn.sourceImages.map((source) => (
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
                    <div className="max-w-full rounded-[28px] bg-[#f2f2f1] px-5 py-4 text-[15px] leading-7 text-stone-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                        {turn.prompt || "无额外提示词"}
                    </div>
                </div>
            </div>

            {/* AI 响应 */}
            <div className="space-y-4">
                <div className="flex items-center gap-3 px-1">
                    <span className="flex size-9 items-center justify-center rounded-2xl bg-stone-950 text-white">
                        <Sparkles className="size-4" />
                    </span>
                    <div>
                        <div className="text-sm font-semibold tracking-tight text-stone-900">Eidos</div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-stone-500">
                    <span className="rounded-full bg-stone-100 px-3 py-1.5">{modeLabelMap[turn.mode]}</span>
                    <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.model}</span>
                    <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.count} 张</span>
                    {turn.scale ? (
                        <span className="rounded-full bg-stone-100 px-3 py-1.5">{turn.scale}</span>
                    ) : null}
                    <span className="rounded-full bg-stone-100 px-3 py-1.5">
                        <Clock3 className="mr-1 inline size-3.5" />
                        {formatConversationTime(turn.createdAt)}
                    </span>
                </div>

                {turn.images.length > 0 ? (
                    <div
                        className={cn(
                            "grid gap-4",
                            turn.images.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
                        )}
                    >
                        {turn.images.map((image, index) => (
                            <div
                                key={image.id}
                                className={cn(
                                    "overflow-hidden rounded-[22px] border border-stone-200 bg-white shadow-sm",
                                    turn.images.length === 1 && "w-fit max-w-full justify-self-start",
                                )}
                            >
                                {image.status === "success" && image.b64_json ? (
                                    <div>
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
                                        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-3">
                                            <button
                                                type="button"
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                                onClick={() =>
                                                    onOpenSelectionEditor(
                                                        conversationId,
                                                        turn.id,
                                                        image,
                                                        `${turn.title || "image"}-${index + 1}.png`,
                                                    )
                                                }
                                                title="选区编辑"
                                                aria-label="选区编辑"
                                            >
                                                <Brush className="size-4" />
                                            </button>
                                            <button
                                                type="button"
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                                onClick={() => onSeedFromResult(conversationId, image, "edit")}
                                                title="引用编辑"
                                                aria-label="引用编辑"
                                            >
                                                <Copy className="size-4" />
                                            </button>
                                            <button
                                                type="button"
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                                                onClick={() => onSeedFromResult(conversationId, image, "upscale")}
                                                title="放大"
                                                aria-label="放大"
                                            >
                                                <ZoomIn className="size-4" />
                                            </button>
                                        </div>
                                    </div>
                                ) : image.status === "error" ? (
                                    <div className="flex min-h-[320px] flex-col">
                                        <div className="flex flex-1 items-center justify-center bg-rose-50 px-6 py-8 text-center text-sm leading-7 text-rose-600">
                                            {image.error || "处理失败"}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-3">
                                            <button
                                                type="button"
                                                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                onClick={() => onRetryTurn(conversationId, turn)}
                                                disabled={isSubmitting}
                                                title={isSubmitting ? "处理中" : "重试"}
                                                aria-label="重试"
                                            >
                                                <RotateCcw className="size-4" />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 bg-stone-50 px-6 py-8 text-center text-stone-500">
                                        <div className="rounded-full bg-white p-3 shadow-sm">
                                            <LoaderCircle className="size-5 animate-spin" />
                                        </div>
                                        <p className="text-sm font-medium text-stone-700">
                                            {isProcessing && processingStatus
                                                ? `${processingStatus.title}${waitingDots}`
                                                : "正在处理图片..."}
                                        </p>
                                        <p className="text-xs leading-6 text-stone-400">
                                            {isProcessing && processingStatus
                                                ? `${processingStatus.detail} · 已等待 ${formatProcessingDuration(submitElapsedSeconds)}`
                                                : "图片处理通常需要几十秒，请稍候"}
                                        </p>
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
