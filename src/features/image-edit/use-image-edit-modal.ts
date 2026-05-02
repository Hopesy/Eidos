"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

export type StrokePoint = { x: number; y: number };
export type Stroke = { points: StrokePoint[]; sizeRatio: number };
export type MaskPayload = { file: File; previewDataUrl: string };
export type BrushCursor = { x: number; y: number };

type UseImageEditModalParams = {
  open: boolean;
  imageSrc: string;
  mode?: "selection-edit" | "mask-only";
  isSubmitting: boolean;
  onSubmit?: (payload: { prompt: string; mask: MaskPayload }) => Promise<void>;
  onSubmitMask?: (mask: MaskPayload) => Promise<void>;
};

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

export function useImageEditModal({
  open,
  imageSrc,
  mode = "selection-edit",
  isSubmitting,
  onSubmit,
  onSubmitMask,
}: UseImageEditModalParams) {
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
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasSelection = strokes.length > 0 || currentStroke.length > 0;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleUndo = () => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStrokes((redo) => [...redo, last]);
      return prev.slice(0, -1);
    });
  };

  const handleRedo = () => {
    setRedoStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setStrokes((strokesList) => [...strokesList, last]);
      return prev.slice(0, -1);
    });
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      if (e.key === "[") {
        e.preventDefault();
        setBrushSize((prev) => Math.max(4, prev - 4));
      }
      if (e.key === "]") {
        e.preventDefault();
        setBrushSize((prev) => Math.min(120, prev + 4));
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setSelectionMode((value) => !value);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, strokes.length, redoStrokes.length]);

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

  useEffect(() => {
    if (!open) return;

    const measure = () => {
      const element = imgRef.current;
      if (!element) return;
      setImgDisplaySize({ w: element.clientWidth, h: element.clientHeight });
      if (element.naturalWidth) {
        setImgNaturalSize({ w: element.naturalWidth, h: element.naturalHeight });
      }
    };

    measure();

    const observer = new ResizeObserver(measure);
    if (imgRef.current) observer.observe(imgRef.current);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [open, imageSrc]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    if (imgDisplaySize.w > 0 && imgDisplaySize.h > 0) {
      canvas.width = imgDisplaySize.w;
      canvas.height = imgDisplaySize.h;
    }
  }, [imgDisplaySize]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = imgDisplaySize;
    ctx.clearRect(0, 0, w, h);

    const allStrokes = [...strokes];
    if (currentStroke.length > 0) {
      const sizeRatio = h > 0 ? brushSize / (2 * Math.min(w, h)) : 0;
      allStrokes.push({ points: currentStroke, sizeRatio });
    }

    for (const stroke of allStrokes) {
      renderStroke(ctx, stroke, w, h, "rgba(59,130,246,0.55)");
    }
  }, [strokes, currentStroke, imgDisplaySize, brushSize]);

  const getRelativePoint = (e: ReactPointerEvent<HTMLDivElement>): StrokePoint => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const x = clampPoint((e.clientX - rect.left) / rect.width);
    const y = clampPoint((e.clientY - rect.top) / rect.height);
    return { x, y };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (!selectionMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = getRelativePoint(e);
    setIsDrawing(true);
    setCurrentStroke([point]);
    setRedoStrokes([]);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
    const point = getRelativePoint(e);
    setCurrentStroke((prev) => [...prev, point]);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (!selectionMode || !isDrawing) return;
    const point = getRelativePoint(e);
    const finalPoints = currentStroke.length > 0 ? [...currentStroke, point] : [point];
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setScale((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [open]);

  const handleClear = () => {
    setStrokes([]);
    setRedoStrokes([]);
    setCurrentStroke([]);
  };

  const buildMaskPayload = async (): Promise<MaskPayload> => {
    const naturalWidth = imgNaturalSize.w || 1024;
    const naturalHeight = imgNaturalSize.h || 1024;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = naturalWidth;
    maskCanvas.height = naturalHeight;
    const maskCtx = maskCanvas.getContext("2d")!;

    maskCtx.fillStyle = "#ffffff";
    maskCtx.fillRect(0, 0, naturalWidth, naturalHeight);
    maskCtx.globalCompositeOperation = "destination-out";
    for (const stroke of strokes) {
      renderStroke(maskCtx, stroke, naturalWidth, naturalHeight, "rgba(0,0,0,1)");
    }
    maskCtx.globalCompositeOperation = "source-over";

    const blob = await canvasToBlob(maskCanvas);
    const file = new File([blob], "mask.png", { type: "image/png" });

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = naturalWidth;
    previewCanvas.height = naturalHeight;
    const previewCtx = previewCanvas.getContext("2d")!;

    const image = new window.Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
      image.src = imageSrc;
    });
    previewCtx.drawImage(image, 0, 0, naturalWidth, naturalHeight);

    for (const stroke of strokes) {
      renderStroke(previewCtx, stroke, naturalWidth, naturalHeight, "rgba(59,130,246,0.55)");
    }

    return {
      file,
      previewDataUrl: previewCanvas.toDataURL("image/png"),
    };
  };

  const handleSubmit = async () => {
    if (!hasSelection) {
      toast.error("请先在图片上绘制选区");
      return;
    }
    try {
      const mask = await buildMaskPayload();
      if (mode === "mask-only") {
        if (!onSubmitMask) {
          throw new Error("缺少遮罩提交处理器");
        }
        await onSubmitMask(mask);
        return;
      }

      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        toast.error("请输入编辑提示词");
        return;
      }
      if (!onSubmit) {
        throw new Error("缺少编辑提交处理器");
      }
      await onSubmit({ prompt: trimmedPrompt, mask });
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      toast.error(message);
    }
  };

  const brushCursorPx = useMemo(() => {
    if (!brushCursor || imgDisplaySize.w === 0) return null;
    return {
      x: brushCursor.x * imgDisplaySize.w,
      y: brushCursor.y * imgDisplaySize.h,
    };
  }, [brushCursor, imgDisplaySize]);

  return {
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
    isDrawing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
    handleUndo,
    handleRedo,
    handleClear,
    handleSubmit,
  };
}
