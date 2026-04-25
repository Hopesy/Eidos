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
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") {
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
    }
  }, [open, imageSrc]);

  // Mouse wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      setScale((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [open]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Middle mouse button or left button for panning
    if (e.button === 1 || e.button === 0) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
          className="pointer-events-none fixed z-50 overflow-hidden rounded-full border-4 border-white shadow-2xl"
          style={{
            width: 200,
            height: 200,
            left: magnifierPos.x - 100,
            top: magnifierPos.y - 100,
            backgroundImage: `url(${imageSrc})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${(imageRef.current?.naturalWidth || 0) * 2.5}px ${(imageRef.current?.naturalHeight || 0) * 2.5}px`,
            backgroundPosition: (() => {
              const img = imageRef.current;
              if (!img) return '0 0';
              const rect = img.getBoundingClientRect();
              const x = ((magnifierPos.x - rect.left) / rect.width) * 100;
              const y = ((magnifierPos.y - rect.top) / rect.height) * 100;
              return `${x}% ${y}%`;
            })(),
          }}
        />
      )}

      {/* Hint */}
      {!showMagnifier && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs text-white backdrop-blur-sm">
          按住 Q 键显示放大镜
        </div>
      )}
    </div>
  );
}
