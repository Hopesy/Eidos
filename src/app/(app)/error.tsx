"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-[18px] border border-stone-200 bg-white/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-stone-800 dark:bg-stone-900/70">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="text-sm font-medium text-stone-900 dark:text-stone-100">页面加载失败</div>
        <Button type="button" size="sm" onClick={reset} className="gap-2">
          <RefreshCw className="size-4" />
          重试
        </Button>
      </div>
    </div>
  );
}
