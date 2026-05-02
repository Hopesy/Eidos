import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-[18px] border border-stone-200 bg-white/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-stone-800 dark:bg-stone-900/70">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="text-sm font-medium text-stone-900 dark:text-stone-100">页面不存在</div>
        <Button asChild size="sm">
          <Link href="/image">返回图片工作区</Link>
        </Button>
      </div>
    </div>
  );
}
