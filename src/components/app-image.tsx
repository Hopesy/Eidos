"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  unoptimized?: boolean;
};

// Next.js (16.x) dev mode and standalone-server startup occasionally surface a transient
// "Manifest file is empty" (E328) — the asset endpoint briefly returns 500 while the framework
// rebuilds an internal manifest. By the time the user notices, the file is actually on disk and
// a second request succeeds. Retry once with a cache-busting query so the <img> recovers without
// the user having to refresh the page.
const RETRY_DELAY_MS = 600;

export const AppImage = forwardRef<HTMLImageElement, AppImageProps & { _unoptimized?: boolean }>(
  function AppImage({ _unoptimized: _unused, src, onError, ...props }, ref) {
    const [resolvedSrc, setResolvedSrc] = useState(src);
    const lastSrcRef = useRef(src);
    const retriedRef = useRef(false);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearRetryTimer = useCallback(() => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }, []);

    // Reset retry bookkeeping whenever the caller swaps src for a different image so each new
    // image gets its own retry budget.
    useEffect(() => {
      if (lastSrcRef.current !== src) {
        lastSrcRef.current = src;
        retriedRef.current = false;
        clearRetryTimer();
        setResolvedSrc(src);
      }
    }, [src, clearRetryTimer]);

    useEffect(() => clearRetryTimer, [clearRetryTimer]);

    const handleError = useCallback(
      (event: SyntheticEvent<HTMLImageElement, Event>) => {
        if (!retriedRef.current && src) {
          retriedRef.current = true;
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            const separator = src.includes("?") ? "&" : "?";
            setResolvedSrc(`${src}${separator}__retry=${Date.now()}`);
          }, RETRY_DELAY_MS);
          return;
        }
        onError?.(event);
      },
      [src, onError, clearRetryTimer],
    );

    return <img ref={ref} {...props} src={resolvedSrc} onError={handleError} />;
  },
);
