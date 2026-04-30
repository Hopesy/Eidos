"use client";

import { Brush, Minus, Plus, Redo2, Trash2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type MaskPayload, useImageEditModal } from "@/features/image-edit/use-image-edit-modal";

export type ImageEditModalProps = {
    open: boolean;
    imageName: string;
    imageSrc: string;
    isSubmitting?: boolean;
    onClose: () => void;
    onSubmit: (payload: { prompt: string; mask: MaskPayload }) => Promise<void>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ImageEditModal({
    open,
    imageName,
    imageSrc,
    isSubmitting = false,
    onClose,
    onSubmit,
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
        isSubmitting,
        onSubmit,
    });

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-stone-50 dark:bg-stone-950">
            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <header className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900 sm:px-6">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        onClick={onClose}
                        disabled={isSubmitting}
                        aria-label="关闭"
                    >
                        <X className="size-5" />
                    </Button>

                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                            编辑图片
                        </span>
                        <span className="truncate text-xs text-stone-500 dark:text-stone-400">{imageName}</span>
                    </div>
                </div>

                {/* Selection status badge */}
                <div className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    hasSelection
                        ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300"
                        : "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                )}>
                    {hasSelection ? `已选择 ${strokes.length} 个区域` : "尚未选择区域"}
                </div>
            </header>

            {/* ── Main ───────────────────────────────────────────────────────────── */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Image preview area */}
                <div
                    ref={containerRef}
                    className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-stone-100/50 dark:bg-stone-900/50"
                >
                    <div
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                            transformOrigin: 'center',
                            transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                        }}
                    >
                        {/* Image */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={imgRef}
                            src={imageSrc}
                            alt={imageName}
                            draggable={false}
                            className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-2xl"
                        />

                        {/* Overlay canvas */}
                        <canvas
                            ref={overlayCanvasRef}
                            className="pointer-events-none absolute rounded-2xl"
                            style={{
                                width: imgDisplaySize.w,
                                height: imgDisplaySize.h,
                                top: 0,
                                left: 0,
                            }}
                        />

                        {/* Touch / pointer interaction layer */}
                        <div
                            className={cn(
                                "absolute rounded-2xl",
                                selectionMode && !isPanning ? "cursor-none" : isPanning ? "cursor-grabbing" : "cursor-default",
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

                        {/* Brush cursor indicator */}
                        {selectionMode && brushCursorPx && !isPanning && (
                            <div
                                className="pointer-events-none absolute rounded-full border-2 border-blue-500 bg-blue-400/20 dark:border-blue-400 dark:bg-blue-500/20"
                                style={{
                                    width: brushSize,
                                    height: brushSize,
                                    left: brushCursorPx.x - brushSize / 2,
                                    top: brushCursorPx.y - brushSize / 2,
                                }}
                            />
                        )}
                    </div>
                </div>

                {/* Floating toolbar - Top Left */}
                <div className="absolute left-4 top-4 flex flex-col gap-2">
                    {/* Brush mode toggle */}
                    <div className="rounded-2xl border border-stone-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95">
                        <Button
                            variant={selectionMode ? "default" : "ghost"}
                            size="sm"
                            className={cn(
                                "gap-1.5 rounded-xl px-3 text-xs font-medium transition-all",
                                selectionMode
                                    ? "bg-blue-500 text-white shadow-sm hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
                                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                            onClick={() => setSelectionMode((v) => !v)}
                            disabled={isSubmitting}
                        >
                            <Brush className="size-3.5" />
                            {selectionMode ? "画笔模式" : "开始选区"}
                        </Button>
                    </div>

                    {/* Brush size control - only shown in selection mode */}
                    {selectionMode && (
                        <div className="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-stone-600 dark:text-stone-400">笔刷</span>
                                <span className="text-xs font-semibold tabular-nums text-stone-900 dark:text-stone-100">{brushSize}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    onClick={() => setBrushSize((prev) => Math.max(4, prev - 4))}
                                    disabled={brushSize <= 4}
                                >
                                    <Minus className="size-3.5" />
                                </Button>
                                <input
                                    type="range"
                                    min={4}
                                    max={120}
                                    step={2}
                                    value={brushSize}
                                    onChange={(e) => setBrushSize(Number(e.target.value))}
                                    className="h-1.5 w-24 cursor-pointer accent-blue-500 dark:accent-blue-600"
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                    onClick={() => setBrushSize((prev) => Math.min(120, prev + 4))}
                                    disabled={brushSize >= 120}
                                >
                                    <Plus className="size-3.5" />
                                </Button>
                            </div>
                            <div className="text-[10px] text-stone-400 dark:text-stone-500">
                                快捷键: [ ]
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating toolbar - Top Right */}
                <div className="absolute right-4 top-4 flex flex-col gap-2">
                    {/* Edit controls */}
                    <div className="flex gap-1.5 rounded-2xl border border-stone-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            onClick={handleUndo}
                            disabled={strokes.length === 0 || isSubmitting}
                            title="撤销 (⌘Z)"
                        >
                            <Undo2 className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            onClick={handleRedo}
                            disabled={redoStrokes.length === 0 || isSubmitting}
                            title="重做 (⇧⌘Z)"
                        >
                            <Redo2 className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg text-stone-500 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                            onClick={handleClear}
                            disabled={!hasSelection || isSubmitting}
                            title="清空选区"
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </div>

                    {/* Zoom controls */}
                    <div className="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            onClick={() => setScale((prev) => Math.min(5, prev * 1.2))}
                            disabled={scale >= 5}
                            title="放大"
                        >
                            <ZoomIn className="size-4" />
                        </Button>
                        <div className="px-1 text-center text-[10px] font-medium tabular-nums text-stone-600 dark:text-stone-400">
                            {Math.round(scale * 100)}%
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            onClick={() => setScale((prev) => Math.max(0.1, prev / 1.2))}
                            disabled={scale <= 0.1}
                            title="缩小"
                        >
                            <ZoomOut className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-lg px-2 text-[10px] text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                            onClick={() => {
                                setScale(1);
                                setOffset({ x: 0, y: 0 });
                            }}
                            title="重置视图"
                        >
                            重置
                        </Button>
                    </div>
                </div>

                {/* Helper hint - Bottom Center */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                    <div className="rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-xs text-stone-600 shadow-lg backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-400">
                        {selectionMode
                            ? "拖拽涂抹创建选区 · 中键拖拽平移 · 滚轮缩放"
                            : "点击「开始选区」开始编辑"}
                    </div>
                </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────────────────────── */}
            <footer className="shrink-0 border-t border-stone-200 bg-white px-4 py-4 dark:border-stone-800 dark:bg-stone-900 sm:px-6">
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                    {/* Prompt textarea */}
                    <div className="relative rounded-2xl border border-stone-200 bg-stone-50 shadow-sm transition-all focus-within:border-stone-300 focus-within:bg-white focus-within:shadow-md dark:border-stone-700 dark:bg-stone-800 dark:focus-within:border-stone-600 dark:focus-within:bg-stone-800">
                        <Textarea
                            placeholder="描述你希望如何修改选区内的内容…"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            disabled={isSubmitting}
                            rows={3}
                            className={cn(
                                "resize-none rounded-2xl border-0 bg-transparent px-5 py-4 text-sm text-stone-900",
                                "placeholder:text-stone-400 focus-visible:ring-0 dark:text-stone-100 dark:placeholder:text-stone-500",
                                "min-h-[80px] max-h-[180px]",
                            )}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    void handleSubmit();
                                }
                            }}
                        />

                        {/* Submit button */}
                        <div className="flex items-center justify-end px-4 pb-3">
                            <Button
                                onClick={() => void handleSubmit()}
                                disabled={isSubmitting || !prompt.trim() || !hasSelection}
                                className={cn(
                                    "rounded-full px-5 text-sm font-medium transition-all",
                                    "bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200",
                                    "disabled:opacity-50",
                                )}
                            >
                                {isSubmitting ? (
                                    <>
                                        <svg
                                            className="size-4 animate-spin"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                        >
                                            <circle
                                                className="opacity-25"
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                strokeWidth="4"
                                            />
                                            <path
                                                className="opacity-75"
                                                fill="currentColor"
                                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                            />
                                        </svg>
                                        提交中…
                                    </>
                                ) : (
                                    "提交编辑"
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Keyboard hints */}
                    <div className="flex items-center justify-center gap-4 text-[10px] text-stone-400 dark:text-stone-500">
                        <span>⌘ Enter 提交</span>
                        <span>·</span>
                        <span>B 切换画笔</span>
                        <span>·</span>
                        <span>[ ] 调整笔刷</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
