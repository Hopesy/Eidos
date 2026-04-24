"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { Brush, Redo2, Trash2, Undo2, X } from "lucide-react";
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
    const [selectionMode, setSelectionMode] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);

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

    // ── Reset state on open / imageSrc change ───────────────────────────────────
    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setSelectionMode(false);
        setBrushSize(32);
        setStrokes([]);
        setRedoStrokes([]);
        setCurrentStroke([]);
        setBrushCursor(null);
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
        if (!selectionMode) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const pt = getRelativePoint(e);
        setIsDrawing(true);
        setCurrentStroke([pt]);
        setRedoStrokes([]);
    };

    const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
    };

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
        <div className="fixed inset-0 z-50 flex flex-col bg-white/90 backdrop-blur-sm">
            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <header className="flex shrink-0 items-center gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
                {/* Close */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-stone-500 hover:text-stone-800"
                    onClick={onClose}
                    disabled={isSubmitting}
                    aria-label="关闭"
                >
                    <X className="size-5" />
                </Button>

                {/* Title */}
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-stone-800">
                        编辑图片
                    </span>
                    <span className="truncate text-xs text-stone-400">{imageName}</span>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-stone-500 hover:text-stone-800 disabled:opacity-40"
                        onClick={handleUndo}
                        disabled={strokes.length === 0 || isSubmitting}
                        aria-label="撤销"
                    >
                        <Undo2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-stone-500 hover:text-stone-800 disabled:opacity-40"
                        onClick={handleRedo}
                        disabled={redoStrokes.length === 0 || isSubmitting}
                        aria-label="重做"
                    >
                        <Redo2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-stone-500 hover:text-stone-800 disabled:opacity-40"
                        onClick={handleClear}
                        disabled={!hasSelection || isSubmitting}
                        aria-label="清空选区"
                    >
                        <Trash2 className="size-4" />
                    </Button>

                    {/* Selection mode toggle */}
                    <Button
                        variant={selectionMode ? "default" : "outline"}
                        size="sm"
                        className={cn(
                            "ml-1 gap-1.5 rounded-full px-3 text-xs font-medium transition-all",
                            selectionMode
                                ? "bg-blue-500 text-white shadow-md hover:bg-blue-600"
                                : "border-stone-300 text-stone-600 hover:border-blue-400 hover:text-blue-600",
                        )}
                        onClick={() => setSelectionMode((v) => !v)}
                        disabled={isSubmitting}
                    >
                        <Brush className="size-3.5" />
                        {selectionMode ? "画笔模式" : "开始选区"}
                    </Button>
                </div>
            </header>

            {/* ── Main ───────────────────────────────────────────────────────────── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Helper bar + brush size */}
                <div className="flex shrink-0 flex-col gap-2 px-4 py-3 sm:px-6">
                    {/* helper hint */}
                    <p className="text-center text-xs text-stone-400">
                        {selectionMode
                            ? "在图片上拖拽涂抹以创建选区，选区将作为编辑区域"
                            : "点击「开始选区」，然后在图片上涂抹需要编辑的区域"}
                    </p>

                    {/* Brush size slider – only shown in selection mode */}
                    {selectionMode && (
                        <div className="flex items-center gap-3 px-2">
                            <span className="shrink-0 text-xs text-stone-500">笔刷大小</span>
                            <input
                                type="range"
                                min={4}
                                max={120}
                                step={2}
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="h-1.5 flex-1 cursor-pointer accent-blue-500"
                            />
                            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-stone-500">
                                {brushSize}
                            </span>
                        </div>
                    )}
                </div>

                {/* Image preview area */}
                <div
                    ref={containerRef}
                    className="relative mx-auto flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-2 sm:px-6"
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
                        className="max-h-full max-w-full select-none rounded-[20px] object-contain shadow-lg"
                    />

                    {/* Overlay canvas */}
                    <canvas
                        ref={overlayCanvasRef}
                        className={cn(
                            "pointer-events-none absolute rounded-[20px]",
                        )}
                        style={{
                            width: imgDisplaySize.w,
                            height: imgDisplaySize.h,
                        }}
                    />

                    {/* Touch / pointer interaction layer */}
                    <div
                        className={cn(
                            "absolute rounded-[20px]",
                            selectionMode ? "cursor-none" : "cursor-default",
                        )}
                        style={{
                            width: imgDisplaySize.w,
                            height: imgDisplaySize.h,
                            touchAction: "none",
                        }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerLeave}
                        onPointerCancel={handlePointerCancel}
                    />

                    {/* Brush cursor indicator */}
                    {selectionMode && brushCursorPx && (
                        <div
                            className="pointer-events-none absolute rounded-full border-2 border-blue-500 bg-blue-300/30"
                            style={{
                                width: brushSize,
                                height: brushSize,
                                left:
                                    // position relative to container, accounting for image offset
                                    (() => {
                                        const el = containerRef.current;
                                        const img = imgRef.current;
                                        if (!el || !img) return brushCursorPx.x;
                                        const containerRect = el.getBoundingClientRect();
                                        const imgRect = img.getBoundingClientRect();
                                        return imgRect.left - containerRect.left + brushCursorPx.x - brushSize / 2;
                                    })(),
                                top: (() => {
                                    const el = containerRef.current;
                                    const img = imgRef.current;
                                    if (!el || !img) return brushCursorPx.y;
                                    const containerRect = el.getBoundingClientRect();
                                    const imgRect = img.getBoundingClientRect();
                                    return imgRect.top - containerRect.top + brushCursorPx.y - brushSize / 2;
                                })(),
                            }}
                        />
                    )}
                </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────────────────────── */}
            <footer className="shrink-0 border-t border-stone-200 px-4 py-4 sm:px-6">
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                    {/* Prompt textarea */}
                    <div className="relative rounded-[28px] border border-stone-200 bg-white shadow-sm transition-shadow focus-within:border-stone-300 focus-within:shadow-md">
                        <Textarea
                            placeholder="描述你希望如何修改选区内的内容…"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            disabled={isSubmitting}
                            rows={3}
                            className={cn(
                                "resize-none rounded-[28px] border-0 bg-transparent px-5 py-4 text-sm text-stone-800",
                                "placeholder:text-stone-400 focus-visible:ring-0",
                                "min-h-[80px] max-h-[180px]",
                            )}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    void handleSubmit();
                                }
                            }}
                        />

                        {/* Submit row */}
                        <div className="flex items-center justify-between px-4 pb-3">
                            {/* Selection status */}
                            <span
                                className={cn(
                                    "text-xs",
                                    hasSelection ? "text-blue-500" : "text-stone-400",
                                )}
                            >
                                {hasSelection
                                    ? `已选择 ${strokes.length} 个区域`
                                    : "尚未选择区域"}
                            </span>

                            <Button
                                onClick={() => void handleSubmit()}
                                disabled={isSubmitting || !prompt.trim() || !hasSelection}
                                className={cn(
                                    "rounded-full px-5 text-sm font-medium transition-all",
                                    "bg-stone-800 text-white hover:bg-stone-700",
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

                    {/* Keyboard hint */}
                    <p className="text-center text-xs text-stone-400">
                        按 <kbd className="rounded border border-stone-200 px-1 font-mono text-[10px]">⌘ Enter</kbd> 快速提交
                    </p>
                </div>
            </footer>
        </div>
    );
}
