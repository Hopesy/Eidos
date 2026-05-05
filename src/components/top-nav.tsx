"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ImageIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Settings2,
  Shield,
  Sun,
} from "lucide-react";

import { fetchVersionInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTheme } from "@/components/theme-provider";
import { UpdateDialog } from "@/components/update-dialog";

const repositoryUrl = "https://github.com/Hopesy/Eidos";

function formatVersionLabel(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/^v+/i, "");
  return normalized ? `v${normalized}` : "读取中";
}

const navItems = [
  { href: "/image", label: "图片", description: "生成、编辑与放大", pageTitle: "图片工作台", icon: ImageIcon },
  { href: "/accounts", label: "账号", description: "号池、额度与同步", pageTitle: "号池管理", icon: Shield },
  { href: "/requests", label: "请求", description: "查看调用状态与结果", pageTitle: "调用请求", icon: Activity },
  { href: "/settings", label: "设置", description: "模式、接口与后端配置", pageTitle: "配置管理", icon: Settings2 },
];

function isNavItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveMobileTitle(pathname: string) {
  const matched = navItems.find((item) => isNavItemActive(pathname, item.href));
  return matched?.pageTitle ?? "EIDOS";
}

function resolveMobileSubtitle(pathname: string) {
  const matched = navItems.find((item) => isNavItemActive(pathname, item.href));
  return matched?.description ?? "本地图片工作流";
}

function MobileThemeButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => {
        if (!mounted) return;
        setTheme(isDark ? "light" : "dark");
      }}
      className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200/80 bg-white/80 text-stone-600 shadow-sm transition hover:bg-white hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100"
      aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      disabled={!mounted}
    >
      {mounted ? (
        isDark ? <Sun className="size-4" /> : <Moon className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
    </button>
  );
}

type DesktopTopNavProps = {
  pathname: string;
  defaultCollapsed: boolean;
  versionLabel: string;
};

function DesktopTopNav({
  pathname,
  defaultCollapsed,
  versionLabel,
}: DesktopTopNavProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 transition-[width] duration-200 lg:flex",
        collapsed ? "w-[60px]" : "w-[196px]",
      )}
    >
      <div className="flex h-full w-full flex-col rounded-[18px] border border-stone-200 bg-[#f0f0ed] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-stone-700 dark:bg-stone-900 dark:shadow-none">
        <div
          className={cn(
            "gap-2",
            collapsed
              ? "flex flex-col items-center"
              : "flex items-center justify-between",
          )}
        >
          <Link
            href="/image"
            className={cn(
              "flex items-center rounded-2xl transition",
              collapsed
                ? "justify-center px-0 py-1"
                : "min-w-0 flex-1 gap-3 px-3 py-3",
            )}
          >
            <BrandMark className={cn(collapsed ? "size-9" : "size-8")} />
            {!collapsed ? (
              <span className="min-w-0 truncate text-sm font-semibold tracking-[0.18em] text-stone-900 dark:text-stone-100">
                EIDOS
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-2xl border transition-all",
              "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900",
              "dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100",
              collapsed ? "size-11" : "size-10",
            )}
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "展开导航" : "收起导航"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>

        <nav className="mt-4 space-y-1">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex transition-all duration-200",
                  collapsed
                    ? "justify-center rounded-2xl px-0 py-1.5"
                    : "items-center gap-3 overflow-hidden rounded-2xl border px-3 py-3",
                  !collapsed && (
                    active
                      ? "border-stone-200/90 bg-white text-stone-950 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:shadow-none"
                      : "border-transparent text-stone-600 hover:border-white/80 hover:bg-white/75 hover:text-stone-900 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-800/50 dark:hover:text-stone-100"
                  ),
                )}
                title={collapsed ? item.pageTitle : undefined}
              >
                {!collapsed && active ? (
                  <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-stone-950 dark:bg-stone-100" />
                ) : null}
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-2xl transition-all duration-200",
                    collapsed ? "size-10" : "size-9",
                    active
                      ? "bg-stone-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.20)] dark:bg-stone-100 dark:text-stone-900"
                      : collapsed
                        ? "text-stone-500 hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                        : "bg-white/85 text-stone-600 group-hover:bg-white group-hover:text-stone-900 dark:bg-stone-800/50 dark:text-stone-400 dark:group-hover:bg-stone-800 dark:group-hover:text-stone-100",
                  )}
                >
                  <Icon className={cn(collapsed ? "size-5" : "size-4")} />
                </span>
                {!collapsed ? (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.pageTitle}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {item.description}
                    </span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1.5">
          <ThemeToggle collapsed={collapsed} />
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex w-full items-center justify-center text-sm font-medium text-stone-900 transition hover:text-stone-700 dark:text-stone-100 dark:hover:text-stone-300",
              collapsed ? "py-1.5" : "gap-2 py-1.5",
            )}
            title={collapsed ? "打开 GitHub 仓库" : undefined}
          >
            <svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            {!collapsed ? "GitHub" : null}
          </a>
          <button
            type="button"
            onClick={() => setShowUpdateDialog(true)}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 text-xs text-stone-400 transition hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300",
              collapsed ? "py-0.5" : "py-0.5",
            )}
            title="检查更新"
          >
            <RefreshCcw className="size-3" />
            {versionLabel}
          </button>
        </div>
        <UpdateDialog
          open={showUpdateDialog}
          onClose={() => setShowUpdateDialog(false)}
          currentVersionLabel={versionLabel}
        />
      </div>
    </aside>
  );
}

type MobileTopBarProps = {
  pathname: string;
  versionLabel: string;
};

function MobileTopBar({ pathname, versionLabel }: MobileTopBarProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 lg:hidden">
        <div className="rounded-[18px] border border-stone-200/80 bg-[#f5f5f3]/88 px-4 py-3 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-stone-700/80 dark:bg-stone-950/82">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="inline-flex shrink-0 items-center rounded-full transition hover:opacity-85"
                  aria-label="打开导航"
                >
                  <BrandMark className="size-9" />
                </button>
                <Link
                  href="/image"
                  className="inline-flex items-center gap-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 transition hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  EIDOS
                </Link>
              </div>
              <div className="mt-2 min-w-0">
                <h1 className="truncate text-[22px] font-semibold tracking-tight text-stone-950 dark:text-stone-50">
                  {resolveMobileTitle(pathname)}
                </h1>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                  {resolveMobileSubtitle(pathname)}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <MobileThemeButton />
              <button
                type="button"
                onClick={() => setShowUpdateDialog(true)}
                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200/80 bg-white/80 text-stone-600 shadow-sm transition hover:bg-white hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                aria-label="检查更新"
                title={versionLabel}
              >
                <RefreshCcw className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <UpdateDialog
        open={showUpdateDialog}
        onClose={() => setShowUpdateDialog(false)}
        currentVersionLabel={versionLabel}
      />

      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          navOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!navOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-stone-950/38 backdrop-blur-sm transition-opacity duration-200",
            navOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setNavOpen(false)}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex w-[min(84vw,320px)] max-w-full flex-col border-r border-stone-200/80 bg-[#f5f5f3]/98 p-4 shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45)] backdrop-blur-2xl transition-transform duration-200 dark:border-stone-700/80 dark:bg-stone-950/96",
            navOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/image"
              className="inline-flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1 text-stone-900 dark:text-stone-100"
              onClick={() => setNavOpen(false)}
            >
              <BrandMark className="size-9" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-[0.18em]">EIDOS</div>
                <div className="truncate text-xs text-stone-500 dark:text-stone-400">本地图片工作流</div>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200/80 bg-white/80 text-stone-600 shadow-sm transition hover:bg-white hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              aria-label="关闭导航"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>

          <nav className="mt-5 space-y-2">
            {navItems.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setNavOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200",
                    active
                      ? "border-stone-200/90 bg-white text-stone-950 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:shadow-none"
                      : "border-transparent text-stone-600 hover:border-white/80 hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-800/50 dark:hover:text-stone-100",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-2xl",
                      active
                        ? "bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-900"
                        : "bg-white/85 text-stone-600 dark:bg-stone-800/50 dark:text-stone-400",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.pageTitle}</span>
                    <span className="block truncate text-xs text-stone-500">{item.description}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto space-y-2">
            <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-2.5 dark:border-stone-700 dark:bg-stone-900/80">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
                当前版本
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowUpdateDialog(true);
                  setNavOpen(false);
                }}
                className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-stone-700 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100"
              >
                <RefreshCcw className="size-3.5" />
                {versionLabel}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MobileThemeButton />
              <a
                href={repositoryUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center rounded-full border border-stone-200/80 bg-white/80 px-3 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-white hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100"
              >
                GitHub
              </a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const isImageRoute = pathname === "/image" || pathname?.startsWith("/image/");
  const [versionLabel, setVersionLabel] = useState("读取中");

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      try {
        const payload = await fetchVersionInfo();
        if (!cancelled) {
          setVersionLabel(formatVersionLabel(payload.version));
        }
      } catch {
        if (!cancelled) {
          setVersionLabel("未知版本");
        }
      }
    };

    void loadVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <MobileTopBar pathname={pathname} versionLabel={versionLabel} />
      <DesktopTopNav
        pathname={pathname}
        defaultCollapsed={isImageRoute}
        versionLabel={versionLabel}
      />
    </>
  );
}
