"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f3] p-6 dark:bg-stone-950">
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
