"use client";

import { Brush, MousePointer2, Redo2, Trash2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type MaskPayload, useImageEditModal } from "@/features/image-edit/use-image-edit-modal";

export type ImageEditModalProps = {
    open: boolean;
    imageName: string;
    imageSrc: string;
    mode?: "selection-edit" | "mask-only";
    isSubmitting?: boolean;
    onClose: () => void;
    onSubmit?: (payload: { prompt: string; mask: MaskPayload }) => Promise<void>;
    onSubmitMask?: (mask: MaskPayload) => Promise<void>;
};

const TOOL_BUTTON_BASE =
    "size-9 rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

const TOOL_BUTTON_ACTIVE =
    "bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 dark:hover:text-neutral-900";

export function ImageEditModal({
    open,
    imageName,
    imageSrc,
    mode = "selection-edit",
    isSubmitting = false,
    onClose,
    onSubmit,
    onSubmitMask,
}: ImageEditModalProps) {
    const {
        prompt,
        setPrompt,
        brushSize,
        setBrushSize,
        strokes,
        redoStrokes,
        brushCursorPx,
        selectionMode,
        setSelectionMode,
        scale,
        setScale,
        offset,
        setOffset,
        isPanning,
        hasSelection,
        imgRef,
        overlayCanvasRef,
        containerRef,
        imgDisplaySize,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerLeave,
        handlePointerCancel,
        handleUndo,
        handleRedo,
        handleClear,
        handleSubmit,
    } = useImageEditModal({
        open,
        imageSrc,
        mode,
        isSubmitting,
        onSubmit,
        onSubmitMask,
    });

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-950">
            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <header className="flex shrink-0 items-center justify-between border-b border-neutral-200/80 px-4 py-2.5 dark:border-neutral-800/80 sm:px-5">
                <div className="flex min-w-0 items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL_BUTTON_BASE, "size-8")}
                        onClick={onClose}
                        disabled={isSubmitting}
                        aria-label="关闭"
                    >
                        <X className="size-4" />
                    </Button>
                    <div className="flex min-w-0 items-baseline gap-2">
                        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {mode === "mask-only" ? "添加遮罩" : "编辑图片"}
                        </span>
                        <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                            {imageName}
                        </span>
                    </div>
                </div>

                <span
                    className={cn(
                        "text-xs tabular-nums transition-colors",
                        hasSelection
                            ? "text-neutral-900 dark:text-neutral-100"
                            : "text-neutral-400 dark:text-neutral-500",
                    )}
                >
                    {hasSelection ? `${strokes.length} 个选区` : "未选择"}
                </span>
            </header>

            {/* ── Main ───────────────────────────────────────────────────────────── */}
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {/* Left tool rail (Figma/PS style vertical toolbar) */}
                <aside className="flex shrink-0 flex-col items-center gap-1 border-r border-neutral-200/80 px-2 py-3 dark:border-neutral-800/80">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL_BUTTON_BASE, !selectionMode && TOOL_BUTTON_ACTIVE)}
                        onClick={() => setSelectionMode(false)}
                        disabled={isSubmitting}
                        title="移动 / 平移视图 (V)"
                        aria-label="移动"
                    >
                        <MousePointer2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL_BUTTON_BASE, selectionMode && TOOL_BUTTON_ACTIVE)}
                        onClick={() => setSelectionMode(true)}
                        disabled={isSubmitting}
                        title="画笔选区 (B)"
                        aria-label="画笔"
                    >
                        <Brush className="size-4" />
                    </Button>

                    <div className="my-2 h-px w-7 bg-neutral-200 dark:bg-neutral-800" />

                    <Button
                        variant="ghost"
                        size="icon"
                        className={TOOL_BUTTON_BASE}
                        onClick={handleUndo}
                        disabled={strokes.length === 0 || isSubmitting}
                        title="撤销 (⌘Z)"
                        aria-label="撤销"
                    >
                        <Undo2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={TOOL_BUTTON_BASE}
                        onClick={handleRedo}
                        disabled={redoStrokes.length === 0 || isSubmitting}
                        title="重做 (⇧⌘Z)"
                        aria-label="重做"
                    >
                        <Redo2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            TOOL_BUTTON_BASE,
                            "hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300",
                        )}
                        onClick={handleClear}
                        disabled={!hasSelection || isSubmitting}
                        title="清空选区"
                        aria-label="清空"
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </aside>

                {/* Canvas surface */}
                <div
                    ref={containerRef}
                    className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-100/70 dark:bg-black/40"
                >
                    {/* Subtle checker grid background for visual depth */}
                    <div
                        className="absolute inset-0 opacity-[0.4] dark:opacity-[0.15]"
                        style={{
                            backgroundImage:
                                "radial-gradient(circle at 1px 1px, rgb(0 0 0 / 0.08) 1px, transparent 0)",
                            backgroundSize: "20px 20px",
                        }}
                    />

                    <div
                        className="relative"
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                            transformOrigin: "center",
                            transition: isPanning ? "none" : "transform 0.12s ease-out",
                        }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={imgRef}
                            src={imageSrc}
                            alt={imageName}
                            draggable={false}
                            className="max-h-full max-w-full select-none object-contain shadow-[0_4px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-black/5 dark:shadow-[0_4px_28px_-6px_rgba(0,0,0,0.5)] dark:ring-white/5"
                        />

                        <canvas
                            ref={overlayCanvasRef}
                            className="pointer-events-none absolute"
                            style={{
                                width: imgDisplaySize.w,
                                height: imgDisplaySize.h,
                                top: 0,
                                left: 0,
                            }}
                        />

                        <div
                            className={cn(
                                "absolute",
                                selectionMode && !isPanning
                                    ? "cursor-none"
                                    : isPanning
                                        ? "cursor-grabbing"
                                        : "cursor-grab",
                            )}
                            style={{
                                width: imgDisplaySize.w,
                                height: imgDisplaySize.h,
                                touchAction: "none",
                                top: 0,
                                left: 0,
                            }}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerLeave}
                            onPointerCancel={handlePointerCancel}
                        />

                        {selectionMode && brushCursorPx && !isPanning && (
                            <div
                                className="pointer-events-none absolute rounded-full border border-neutral-900/70 mix-blend-difference dark:border-white/80"
                                style={{
                                    width: brushSize,
                                    height: brushSize,
                                    left: brushCursorPx.x - brushSize / 2,
                                    top: brushCursorPx.y - brushSize / 2,
                                }}
                            />
                        )}
                    </div>

                    {/* Brush size — bottom-left, only when brush is active */}
                    {selectionMode && (
                        <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-lg border border-neutral-200/80 bg-white/90 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-900/80">
                            <span className="text-neutral-500 dark:text-neutral-400">笔刷</span>
                            <input
                                type="range"
                                min={4}
                                max={120}
                                step={2}
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="h-1 w-28 cursor-pointer accent-neutral-900 dark:accent-white"
                            />
                            <span className="w-7 text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                                {brushSize}
                            </span>
                        </div>
                    )}

                    {/* Zoom — bottom-right */}
                    <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-neutral-200/80 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-900/80">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(TOOL_BUTTON_BASE, "size-7")}
                            onClick={() => setScale((prev) => Math.max(0.1, prev / 1.2))}
                            disabled={scale <= 0.1}
                            title="缩小"
                            aria-label="缩小"
                        >
                            <ZoomOut className="size-3.5" />
                        </Button>
                        <button
                            type="button"
                            onClick={() => {
                                setScale(1);
                                setOffset({ x: 0, y: 0 });
                            }}
                            className="min-w-12 rounded-md px-1.5 text-xs font-medium tabular-nums text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                            title="重置视图"
                        >
                            {Math.round(scale * 100)}%
                        </button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(TOOL_BUTTON_BASE, "size-7")}
                            onClick={() => setScale((prev) => Math.min(5, prev * 1.2))}
                            disabled={scale >= 5}
                            title="放大"
                            aria-label="放大"
                        >
                            <ZoomIn className="size-3.5" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────────────────────── */}
            <footer className="shrink-0 border-t border-neutral-200/80 px-4 py-3 dark:border-neutral-800/80 sm:px-5">
                <div className="mx-auto max-w-3xl">
                    {mode === "mask-only" ? (
                        <div className="flex items-center justify-end gap-3">
                            <span className="text-xs text-neutral-400 dark:text-neutral-500">
                                {hasSelection ? "选区将作为编辑遮罩" : "请先在画布上涂抹要编辑的区域"}
                            </span>
                            <Button
                                onClick={() => void handleSubmit()}
                                disabled={isSubmitting || !hasSelection}
                                className="h-9 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                            >
                                {isSubmitting ? "保存中…" : "保存遮罩"}
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-end gap-3">
                            <div className="flex-1 rounded-xl border border-neutral-200 bg-white transition-colors focus-within:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600">
                                <Textarea
                                    placeholder="描述你希望如何修改选区内的内容…"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    disabled={isSubmitting}
                                    rows={2}
                                    className="min-h-[60px] max-h-[160px] resize-none border-0 bg-transparent px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                            e.preventDefault();
                                            void handleSubmit();
                                        }
                                    }}
                                />
                                <div className="flex items-center justify-between px-4 pb-2">
                                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                        ⌘ Enter 提交 · B 画笔 · [ ] 调节笔刷
                                    </span>
                                </div>
                            </div>
                            <Button
                                onClick={() => void handleSubmit()}
                                disabled={isSubmitting || !prompt.trim() || !hasSelection}
                                className="h-10 rounded-full bg-neutral-900 px-6 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                            >
                                {isSubmitting ? "提交中…" : "提交编辑"}
                            </Button>
                        </div>
                    )}
                </div>
            </footer>
        </div>
    );
}
