"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ImageIcon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Shield,
  Sparkles,
} from "lucide-react";

import { fetchVersionInfo } from "@/lib/api";
import { clearStoredAuthKey } from "@/store/auth";
import { cn } from "@/lib/utils";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const repositoryUrl = "https://github.com/peiyizhi0724/ChatGpt-Image-Studio";

// ─── 版本格式化 ───────────────────────────────────────────────────────────────

function formatVersionLabel(value: string): string {
  if (!value) return "读取中";
  const normalized = value.replace(/^v/i, "");
  return `v${normalized}`;
}

// ─── 导航项 ───────────────────────────────────────────────────────────────────

const navItems = [
  {
    href: "/image",
    label: "图片工作台",
    description: "AI 图像生成 & 编辑",
    icon: ImageIcon,
  },
  {
    href: "/accounts",
    label: "账号管理",
    description: "账号池与配额管理",
    icon: Shield,
  },
  {
    href: "/settings",
    label: "配置管理",
    description: "系统参数配置",
    icon: Settings2,
  },
  {
    href: "/requests",
    label: "调用请求",
    description: "请求日志与监控",
    icon: Activity,
  },
];

// ─── DesktopTopNav ────────────────────────────────────────────────────────────

interface DesktopTopNavProps {
  pathname: string;
  defaultCollapsed: boolean;
  versionLabel: string;
  onLogout: () => void;
}

function DesktopTopNav({
  pathname,
  defaultCollapsed,
  versionLabel,
  onLogout,
}: DesktopTopNavProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // 当 defaultCollapsed 随路由变化时同步更新
  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  return (
    <aside
      style={{ width: collapsed ? 92 : 228 }}
      className="relative flex h-full flex-col rounded-2xl bg-stone-900 py-4 text-stone-100 shadow-lg transition-[width] duration-300"
    >
      {/* 品牌区 */}
      <div className="flex items-center px-3 pb-3">
        <Link
          href="/image"
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-xl p-2 transition hover:bg-stone-800",
            collapsed && "justify-center",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-400">
            <Sparkles className="size-4" />
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight text-stone-100">
              Image Studio
            </span>
          )}
        </Link>

        {/* 折叠按钮 — 展开时紧跟品牌 */}
        {!collapsed && (
          <button
            type="button"
            aria-label="折叠侧边栏"
            onClick={() => setCollapsed(true)}
            className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {/* 折叠时的展开按钮 */}
      {collapsed && (
        <div className="flex justify-center px-3 pb-1">
          <button
            type="button"
            aria-label="展开侧边栏"
            onClick={() => setCollapsed(false)}
            className="flex size-7 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      )}

      {/* 分隔线 */}
      <div className="mx-3 mb-3 border-t border-stone-700/60" />

      {/* 导航列表 */}
      <nav className="flex flex-1 flex-col gap-1 px-2 overflow-y-auto">
        {navItems.map(({ href, label, description, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? `${label} — ${description}` : undefined}
              className={cn(
                "group flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition",
                collapsed && "justify-center px-2",
                isActive
                  ? "bg-amber-400/15 text-amber-400"
                  : "text-stone-400 hover:bg-stone-800 hover:text-stone-100",
              )}
            >
              <Icon
                className={cn(
                  "size-4.5 shrink-0",
                  isActive ? "text-amber-400" : "text-stone-500 group-hover:text-stone-300",
                )}
              />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate font-medium leading-none",
                      isActive ? "text-amber-400" : "text-stone-200",
                    )}
                  >
                    {label}
                  </p>
                  <p className="mt-1 truncate text-xs leading-none text-stone-500">
                    {description}
                  </p>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 底部区域 */}
      <div className="mt-2 flex flex-col gap-1 px-2">
        {/* 分隔线 */}
        <div className="mx-1 mb-2 border-t border-stone-700/60" />

        {/* 版本块 */}
        <a
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
          title={collapsed ? "查看 GitHub 仓库" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-stone-500 transition hover:bg-stone-800 hover:text-stone-300",
            collapsed && "justify-center px-2",
          )}
        >
          <Sparkles className="size-3.5 shrink-0" />
          {!collapsed && (
            <span className="truncate font-mono">{versionLabel}</span>
          )}
        </a>

        {/* 退出按钮 */}
        <button
          type="button"
          onClick={onLogout}
          title={collapsed ? "退出登录" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-stone-500 transition hover:bg-red-900/30 hover:text-red-400",
            collapsed && "justify-center px-2",
          )}
        >
          <LogOut className="size-3.5 shrink-0" />
          {!collapsed && <span className="truncate">退出登录</span>}
        </button>
      </div>
    </aside>
  );
}

// ─── TopNav（导出） ───────────────────────────────────────────────────────────

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [versionLabel, setVersionLabel] = useState("读取中");

  // 获取版本号
  useEffect(() => {
    fetchVersionInfo()
      .then((info) => {
        const raw = info?.version ?? "";
        setVersionLabel(raw ? formatVersionLabel(raw) : "未知版本");
      })
      .catch(() => {
        setVersionLabel("未知版本");
      });
  }, []);

  const handleLogout = async () => {
    await clearStoredAuthKey();
    router.replace("/login");
  };

  // 登录页不渲染导航
  if (pathname === "/login") {
    return null;
  }

  // /image 及子路由默认折叠侧边栏
  const defaultCollapsed =
    pathname === "/image" || pathname.startsWith("/image/");

  return (
    <>
      {/* ── 移动端顶部导航 ── */}
      <div className="flex flex-col lg:hidden">
        {/* 顶部 Header */}
        <header className="flex items-center justify-between rounded-2xl bg-stone-900 px-4 py-3 text-stone-100 shadow">
          <Link
            href="/image"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-amber-400/20 text-amber-400">
              <Sparkles className="size-3.5" />
            </span>
            <span className="text-stone-100">Image Studio</span>
          </Link>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-stone-800 px-2.5 py-1 font-mono text-xs text-stone-400">
              {versionLabel}
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-800 hover:text-red-400"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {/* 2 列导航卡片 */}
        <nav className="mt-3 grid grid-cols-2 gap-2">
          {navItems.map(({ href, label, description, icon: Icon }) => {
            const isActive =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-3 transition",
                  isActive
                    ? "border-amber-400/30 bg-stone-900/80 text-amber-400"
                    : "border-stone-200 bg-white/60 text-stone-600 hover:border-stone-300 hover:bg-white",
                )}
              >
                <Icon
                  className={cn(
                    "size-5",
                    isActive ? "text-amber-400" : "text-stone-500",
                  )}
                />
                <div>
                  <p
                    className={cn(
                      "text-sm font-semibold leading-none",
                      isActive ? "text-amber-400" : "text-stone-800",
                    )}
                  >
                    {label}
                  </p>
                  <p className="mt-1 text-xs leading-none text-stone-400">
                    {description}
                  </p>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── 桌面端侧边栏 ── */}
      <div className="hidden h-full lg:block">
        <DesktopTopNav
          pathname={pathname}
          defaultCollapsed={defaultCollapsed}
          versionLabel={versionLabel}
          onLogout={() => void handleLogout()}
        />
      </div>
    </>
  );
}
