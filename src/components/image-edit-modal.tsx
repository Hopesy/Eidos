"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { Brush, Minus, Plus, Redo2, Trash2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type StrokePoint = { x: number; y: number };

type Stroke = { points: StrokePoint[]; sizeRatio: number };

type MaskPayload = { file: File; previewDataUrl: string };

type BrushCursor = { x: number; y: number };

export type ImageEditModalProps = {
    open: boolean;
    imageName: string;
    imageSrc: string;
    isSubmitting?: boolean;
    onClose: () => void;
    onSubmit: (payload: { prompt: string; mask: MaskPayload }) => Promise<void>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampPoint(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function renderStroke(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    width: number,
    height: number,
    color: string,
) {
    if (stroke.points.length === 0) return;

    const brushRadius = stroke.sizeRatio * Math.min(width, height);
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = brushRadius * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;

    if (stroke.points.length === 1) {
        const pt = stroke.points[0];
        ctx.beginPath();
        ctx.arc(pt.x * width, pt.y * height, brushRadius, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
        }
        ctx.stroke();
    }

    ctx.restore();
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("canvas.toBlob failed"));
        }, "image/png");
    });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImageEditModal({
    open,
    imageName,
    imageSrc,
    isSubmitting = false,
    onClose,
    onSubmit,
}: ImageEditModalProps) {
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(32);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
    const [currentStroke, setCurrentStroke] = useState<StrokePoint[]>([]);
    const [brushCursor, setBrushCursor] = useState<BrushCursor | null>(null);
    const [selectionMode, setSelectionMode] = useState(true);
    const [isDrawing, setIsDrawing] = useState(false);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });

    const imgRef = useRef<HTMLImageElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });
    const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });

    const hasSelection = strokes.length > 0 || currentStroke.length > 0;

    // ── Lock body scroll when open ──────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Undo: Ctrl/Cmd + Z
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            // Redo: Ctrl/Cmd + Shift + Z
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
                e.preventDefault();
                handleRedo();
            }
            // Brush size: [ and ]
            if (e.key === "[") {
                e.preventDefault();
                setBrushSize((prev) => Math.max(4, prev - 4));
            }
            if (e.key === "]") {
                e.preventDefault();
                setBrushSize((prev) => Math.min(120, prev + 4));
            }
            // Toggle selection mode: B
            if (e.key === "b" || e.key === "B") {
                e.preventDefault();
                setSelectionMode((v) => !v);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, strokes.length, redoStrokes.length]);

    // ── Reset state on open / imageSrc change ───────────────────────────────────
    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setSelectionMode(true);
        setBrushSize(32);
        setStrokes([]);
        setRedoStrokes([]);
        setCurrentStroke([]);
        setBrushCursor(null);
        setScale(1);
        setOffset({ x: 0, y: 0 });
    }, [open, imageSrc]);

    // ── Measure image display size ──────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;

        const measure = () => {
            const el = imgRef.current;
            if (!el) return;
            setImgDisplaySize({ w: el.clientWidth, h: el.clientHeight });
            if (el.naturalWidth) {
                setImgNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
            }
        };

        measure();

        const observer = new ResizeObserver(measure);
        if (imgRef.current) observer.observe(imgRef.current);
        if (containerRef.current) observer.observe(containerRef.current);

        return () => observer.disconnect();
    }, [open, imageSrc]);

    // ── Sync canvas dimensions ──────────────────────────────────────────────────
    useEffect(() => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;
        if (imgDisplaySize.w > 0 && imgDisplaySize.h > 0) {
            canvas.width = imgDisplaySize.w;
            canvas.height = imgDisplaySize.h;
        }
    }, [imgDisplaySize]);

    // ── Redraw overlay canvas ───────────────────────────────────────────────────
    useEffect(() => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { w, h } = imgDisplaySize;
        ctx.clearRect(0, 0, w, h);

        const allStrokes = [...strokes];
        if (currentStroke.length > 0) {
            // find current sizeRatio from brushSize and display size
            const sizeRatio = h > 0 ? brushSize / (2 * Math.min(w, h)) : 0;
            allStrokes.push({ points: currentStroke, sizeRatio });
        }

        for (const stroke of allStrokes) {
            renderStroke(ctx, stroke, w, h, "rgba(59,130,246,0.55)");
        }
    }, [strokes, currentStroke, imgDisplaySize, brushSize]);

    // ── Pointer helpers ─────────────────────────────────────────────────────────
    const getRelativePoint = (
        e: ReactPointerEvent<HTMLDivElement>,
    ): StrokePoint => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return { x: 0.5, y: 0.5 };
        const rect = canvas.getBoundingClientRect();
        const x = clampPoint((e.clientX - rect.left) / rect.width);
        const y = clampPoint((e.clientY - rect.top) / rect.height);
        return { x, y };
    };

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        // Middle mouse button for panning
        if (e.button === 1) {
            e.preventDefault();
            setIsPanning(true);
            setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
            return;
        }

        if (!selectionMode) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const pt = getRelativePoint(e);
        setIsDrawing(true);
        setCurrentStroke([pt]);
        setRedoStrokes([]);
    };

    const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        // Handle panning
        if (isPanning) {
            setOffset({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y,
            });
            return;
        }

        const canvas = overlayCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cx = clampPoint((e.clientX - rect.left) / rect.width);
        const cy = clampPoint((e.clientY - rect.top) / rect.height);
        setBrushCursor({ x: cx, y: cy });

        if (!selectionMode || !isDrawing) return;
        const pt = getRelativePoint(e);
        setCurrentStroke((prev) => [...prev, pt]);
    };

    const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        // End panning
        if (isPanning) {
            setIsPanning(false);
            return;
        }

        if (!selectionMode || !isDrawing) return;
        const pt = getRelativePoint(e);
        const finalPoints = currentStroke.length > 0 ? [...currentStroke, pt] : [pt];
        const sizeRatio =
            imgDisplaySize.w > 0 && imgDisplaySize.h > 0
                ? brushSize / (2 * Math.min(imgDisplaySize.w, imgDisplaySize.h))
                : 0.05;
        setStrokes((prev) => [...prev, { points: finalPoints, sizeRatio }]);
        setCurrentStroke([]);
        setIsDrawing(false);
    };

    const handlePointerLeave = () => {
        setBrushCursor(null);
        if (isPanning) {
            setIsPanning(false);
            return;
        }
        if (!isDrawing) return;
        // commit partial stroke on leave
        if (currentStroke.length > 0) {
            const sizeRatio =
                imgDisplaySize.w > 0 && imgDisplaySize.h > 0
                    ? brushSize / (2 * Math.min(imgDisplaySize.w, imgDisplaySize.h))
                    : 0.05;
            setStrokes((prev) => [...prev, { points: currentStroke, sizeRatio }]);
            setCurrentStroke([]);
        }
        setIsDrawing(false);
    };

    const handlePointerCancel = () => {
        setBrushCursor(null);
        setCurrentStroke([]);
        setIsDrawing(false);
        setIsPanning(false);
    };

    // ── Mouse wheel zoom ────────────────────────────────────────────────────────
    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY;
        const zoomFactor = delta > 0 ? 0.9 : 1.1;
        setScale((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !open) return;
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [open]);

    // ── Undo / Redo / Clear ─────────────────────────────────────────────────────
    const handleUndo = () => {
        setStrokes((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            setRedoStrokes((r) => [...r, last]);
            return prev.slice(0, -1);
        });
    };

    const handleRedo = () => {
        setRedoStrokes((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            setStrokes((s) => [...s, last]);
            return prev.slice(0, -1);
        });
    };

    const handleClear = () => {
        setStrokes([]);
        setRedoStrokes([]);
        setCurrentStroke([]);
    };

    // ── Build mask payload ──────────────────────────────────────────────────────
    const buildMaskPayload = async (): Promise<MaskPayload> => {
        const nw = imgNaturalSize.w || 1024;
        const nh = imgNaturalSize.h || 1024;

        // --- mask canvas: white bg, selection areas are transparent holes ---
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = nw;
        maskCanvas.height = nh;
        const mCtx = maskCanvas.getContext("2d")!;

        // Fill white
        mCtx.fillStyle = "#ffffff";
        mCtx.fillRect(0, 0, nw, nh);

        // Punch out selection (draw on destination-out)
        mCtx.globalCompositeOperation = "destination-out";
        for (const stroke of strokes) {
            renderStroke(mCtx, stroke, nw, nh, "rgba(0,0,0,1)");
        }
        mCtx.globalCompositeOperation = "source-over";

        const blob = await canvasToBlob(maskCanvas);
        const file = new File([blob], "mask.png", { type: "image/png" });

        // --- preview canvas: image + semi-transparent blue overlay ---
        const previewCanvas = document.createElement("canvas");
        previewCanvas.width = nw;
        previewCanvas.height = nh;
        const pCtx = previewCanvas.getContext("2d")!;

        const img = new window.Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = imageSrc;
        });
        pCtx.drawImage(img, 0, 0, nw, nh);

        for (const stroke of strokes) {
            renderStroke(pCtx, stroke, nw, nh, "rgba(59,130,246,0.55)");
        }

        const previewDataUrl = previewCanvas.toDataURL("image/png");
        return { file, previewDataUrl };
    };

    // ── Submit ──────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
            toast.error("请输入编辑提示词");
            return;
        }
        if (!hasSelection) {
            toast.error("请先在图片上绘制选区");
            return;
        }
        try {
            const mask = await buildMaskPayload();
            await onSubmit({ prompt: trimmedPrompt, mask });
        } catch (err) {
            const message = err instanceof Error ? err.message : "提交失败";
            toast.error(message);
        }
    };

    // ── Brush cursor position (pixel) ───────────────────────────────────────────
    const brushCursorPx = useMemo(() => {
        if (!brushCursor || imgDisplaySize.w === 0) return null;
        return {
            x: brushCursor.x * imgDisplaySize.w,
            y: brushCursor.y * imgDisplaySize.h,
        };
    }, [brushCursor, imgDisplaySize]);

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
                            onLoad={() => {
                                const el = imgRef.current;
                                if (!el) return;
                                setImgDisplaySize({ w: el.clientWidth, h: el.clientHeight });
                                setImgNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                            }}
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
