"use client";

import { X } from "lucide-react";
import { useEffect, useState, useRef, type WheelEvent as ReactWheelEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AppImage as Image } from "@/components/app-image";

export type ImagePreviewModalProps = {
  open: boolean;
  imageSrc: string;
  onClose: () => void;
};

export function ImagePreviewModal({ open, imageSrc, onClose }: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const [magnifierZoom, setMagnifierZoom] = useState(3);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") {
        // 使用当前存储的鼠标位置
        setMagnifierPos({ x: currentMousePos.current.x, y: currentMousePos.current.y });
        setShowMagnifier(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") {
        setShowMagnifier(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setIsPanning(false);
      setShowMagnifier(false);
      setMagnifierZoom(3);
    }
  }, [open, imageSrc]);

  // Mouse wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;

      // 如果放大镜开启，调整放大镜倍率
      if (showMagnifier) {
        const zoomChange = delta > 0 ? -0.5 : 0.5;
        setMagnifierZoom((prev) => Math.max(1.5, Math.min(10, prev + zoomChange)));
      } else {
        // 否则调整图片缩放
        const zoomFactor = delta > 0 ? 0.9 : 1.1;
        setScale((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [open, showMagnifier]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Middle mouse button or left button for panning
    if (e.button === 1 || e.button === 0) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 始终更新当前鼠标位置
    currentMousePos.current = { x: e.clientX, y: e.clientY };

    if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }

    // Update magnifier position
    if (showMagnifier) {
      setMagnifierPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
  };

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{ cursor: isPanning ? 'grabbing' : showMagnifier ? 'none' : 'grab' }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-all hover:bg-white/20"
        aria-label="关闭"
      >
        <X className="size-5" />
      </button>

      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: isPanning ? 'none' : 'transform 0.1s ease-out',
        }}
      >
        <Image
          ref={imageRef}
          src={imageSrc}
          alt="预览"
          className="h-auto max-h-[90vh] w-auto max-w-[90vw] object-contain"
        />
      </div>

      {/* Magnifier */}
      {showMagnifier && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: magnifierPos.x - 120,
            top: magnifierPos.y - 120,
          }}
        >
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl" />

          {/* Magnifier circle */}
          <div
            className="relative overflow-hidden rounded-full shadow-2xl ring-4 ring-white/90"
            style={{
              width: 240,
              height: 240,
              backgroundImage: `url(${imageSrc})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${(imageRef.current?.naturalWidth || 0) * magnifierZoom}px ${(imageRef.current?.naturalHeight || 0) * magnifierZoom}px`,
              backgroundPosition: (() => {
                const img = imageRef.current;
                if (!img) return '0 0';
                const rect = img.getBoundingClientRect();
                const x = ((magnifierPos.x - rect.left) / rect.width) * 100;
                const y = ((magnifierPos.y - rect.top) / rect.height) * 100;
                return `${x}% ${y}%`;
              })(),
            }}
          >
            {/* Inner highlight */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />

            {/* Crosshair */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="absolute h-8 w-px bg-white/60 -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute h-px w-8 bg-white/60 -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute size-1 rounded-full bg-white/80 -translate-x-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Zoom indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {magnifierZoom.toFixed(1)}x
          </div>
        </div>
      )}

      {/* Hint */}
      {!showMagnifier && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs text-white backdrop-blur-sm">
          按住 Q 键显示放大镜 · 滚轮调整倍率
        </div>
      )}
    </div>
  );
}
