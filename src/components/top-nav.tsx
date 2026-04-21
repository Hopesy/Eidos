"use client";

import Link from "next/link";
import { Github, LogOut, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import webConfig from "@/constants/common-env";
import { clearStoredAuthKey } from "@/store/auth";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/image", label: "画图" },
  { href: "/accounts", label: "号池管理" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await clearStoredAuthKey();
    router.replace("/login");
  };

  if (pathname === "/login") {
    return null;
  }

  return (
    <header className="sticky top-3 z-30">
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border bg-card/80 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-1 items-center gap-3">
          <Link
            href="/image"
            className="inline-flex items-center gap-2 py-1 text-sm font-semibold tracking-tight text-foreground transition hover:text-primary"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </span>
            chatgpt2api
          </Link>
          <a
            href="https://github.com/basketikun/chatgpt2api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition hover:text-foreground"
            aria-label="GitHub repository"
          >
            <Github className="size-4" />
            <span>GitHub</span>
          </a>
        </div>
        <div className="flex justify-center gap-3">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <span className="rounded-full border bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground">
            v{webConfig.appVersion}
          </span>
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            onClick={() => void handleLogout()}
          >
            <LogOut className="size-4" />
            退出
          </button>
        </div>
      </div>
    </header>
  );
}
