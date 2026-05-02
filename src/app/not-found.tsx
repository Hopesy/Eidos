import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f3] p-6 dark:bg-stone-950">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="text-sm font-medium text-stone-900 dark:text-stone-100">页面不存在</div>
        <Button asChild size="sm">
          <Link href="/image">返回图片工作区</Link>
        </Button>
      </div>
    </div>
  );
}
