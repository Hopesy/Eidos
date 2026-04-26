"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-center rounded-2xl border transition-all",
          "border-stone-200 bg-white text-stone-600",
          "dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400",
          collapsed ? "justify-center px-0 py-3" : "justify-center gap-2 px-4 py-3"
        )}
        disabled
      >
        <Sun className="size-4" />
        {!collapsed && <span className="text-sm font-medium">亮色模式</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn(
        "flex w-full items-center rounded-2xl border transition-all",
        "border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
        "dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100",
        collapsed ? "justify-center px-0 py-3" : "justify-center gap-2 px-4 py-3"
      )}
      title={collapsed ? (theme === "dark" ? "切换到亮色模式" : "切换到暗色模式") : undefined}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {!collapsed && (
        <span className="text-sm font-medium">
          {theme === "dark" ? "亮色模式" : "暗色模式"}
        </span>
      )}
    </button>
  );
}
