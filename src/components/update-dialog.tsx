"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, LoaderCircle, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchLatestReleaseInfo } from "@/lib/api";
import {
  formatDesktopVersion,
  getDesktopUpdaterApi,
  type DesktopUpdaterState,
} from "@/lib/desktop-updater";
import { cn } from "@/lib/utils";

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function resolveUpdateStatusLabel(state: DesktopUpdaterState | null) {
  switch (state?.status) {
    case "checking":
      return "正在检查";
    case "up-to-date":
      return "已是最新";
    case "update-available":
      return "发现更新";
    case "downloading":
      return "正在下载";
    case "installer-ready":
      return "安装包已就绪";
    case "error":
      return "检查失败";
    default:
      return "未检查";
  }
}

function resolveUpdateStatusClassName(state: DesktopUpdaterState | null) {
  switch (state?.status) {
    case "up-to-date":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "update-available":
    case "installer-ready":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300";
    case "downloading":
    case "checking":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-300";
  }
}

function formatLatestReleaseLabel(state: DesktopUpdaterState | null) {
  const versionLabel = formatDesktopVersion(state?.latestVersion);
  const releaseName = String(state?.releaseName || "").trim();
  if (!releaseName) {
    return versionLabel;
  }

  const normalizedVersion = String(state?.latestVersion || "")
    .trim()
    .replace(/^v+/i, "");
  const normalizedReleaseName = releaseName.replace(/^v+/i, "");
  if (normalizedVersion && normalizedReleaseName === normalizedVersion) {
    return `v${normalizedVersion}`;
  }

  return normalizedVersion ? `${releaseName} · v${normalizedVersion}` : releaseName;
}

export type UpdateDialogProps = {
  open: boolean;
  onClose: () => void;
  currentVersionLabel?: string;
};

export function UpdateDialog({ open, onClose, currentVersionLabel }: UpdateDialogProps) {
  const [desktopUpdaterAvailable, setDesktopUpdaterAvailable] = useState(false);
  const [updateState, setUpdateState] = useState<DesktopUpdaterState | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  useEffect(() => {
    const updater = getDesktopUpdaterApi();
    if (!updater) {
      setDesktopUpdaterAvailable(false);
      return;
    }

    setDesktopUpdaterAvailable(true);
    let disposed = false;

    void updater
      .getState()
      .then((state) => {
        if (!disposed) {
          setUpdateState(state);
        }
      })
      .catch(() => {
        if (!disposed) {
          setUpdateState(null);
        }
      });

    const unsubscribe = updater.onStateChange((state) => {
      if (!disposed) {
        setUpdateState(state);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updater = getDesktopUpdaterApi();
    if (!updater) {
      setDesktopUpdaterAvailable(false);
      void checkBrowserRelease({ silent: true }).catch(() => {});
      return;
    }

    setDesktopUpdaterAvailable(true);
    let disposed = false;
    void updater
      .getState()
      .then((state) => {
        if (!disposed) {
          setUpdateState(state);
        }
      })
      .catch(() => {
        if (!disposed) {
          setUpdateState((current) => current);
        }
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  async function checkBrowserRelease(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    setCheckingUpdate(true);
    try {
      const nextState = await fetchLatestReleaseInfo();
      setUpdateState(nextState);

      if (silent) {
        return nextState;
      }

      if (nextState.status === "update-available") {
        toast.success(`发现新版本 ${formatDesktopVersion(nextState.latestVersion)}`);
      } else if (nextState.status === "up-to-date") {
        toast.success("当前已是最新版本");
      } else if (nextState.status === "error") {
        toast.error(nextState.message || "检查更新失败");
      }

      return nextState;
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : "检查更新失败");
      }
      throw error;
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function checkDesktopUpdate() {
    const updater = getDesktopUpdaterApi();
    if (!updater) {
      await checkBrowserRelease();
      return;
    }

    setCheckingUpdate(true);
    try {
      const nextState = await updater.checkForUpdates();
      setUpdateState(nextState);
      if (nextState.status === "update-available") {
        toast.success(`发现新版本 ${formatDesktopVersion(nextState.latestVersion)}`);
      } else if (nextState.status === "up-to-date") {
        toast.success("当前已是最新版本");
      } else if (nextState.status === "error") {
        toast.error(nextState.message || "检查更新失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "检查更新失败");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function downloadAndInstallUpdate() {
    const updater = getDesktopUpdaterApi();
    if (!updater) {
      toast.info("当前是浏览器模式，自动更新仅桌面版可用");
      return;
    }

    setInstallingUpdate(true);
    try {
      const nextState = await updater.downloadAndInstall();
      setUpdateState(nextState);
      if (nextState.status === "installer-ready") {
        toast.success("安装包已启动，请按安装向导完成更新");
      } else if (nextState.status === "error") {
        toast.error(nextState.message || "下载安装包失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载安装包失败");
    } finally {
      setInstallingUpdate(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-700 dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>

        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">检查更新</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          桌面版会自动检查 GitHub Release；浏览器模式也会展示最新 Release 信息
        </p>

        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-stone-800 dark:text-stone-100">更新状态</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
                resolveUpdateStatusClassName(updateState),
              )}
            >
              {resolveUpdateStatusLabel(updateState)}
            </span>
            {!desktopUpdaterAvailable ? (
              <span className="text-xs text-stone-500 dark:text-stone-400">
                当前是浏览器模式，仅支持查看 Release 信息
              </span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
              <div className="mt-1 font-medium text-stone-900 dark:text-stone-100">
                {formatDesktopVersion(updateState?.currentVersion || currentVersionLabel)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">最新 Release</div>
              <div className="mt-1 font-medium text-stone-900 dark:text-stone-100">
                {formatLatestReleaseLabel(updateState)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">发布时间</div>
              <div className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                {formatTimestamp(updateState?.publishedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">安装包</div>
              <div className="mt-1 break-all text-sm text-stone-600 dark:text-stone-300">
                {updateState?.assetName || "—"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/80 px-3 py-2 text-xs leading-6 text-stone-600 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300">
            {updateState?.message ||
              "桌面版可在这里检查更新并下载安装包；浏览器模式可查看 GitHub Release 最新信息。"}
          </div>

          {updateState?.status === "downloading" ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <div
                  className="h-full rounded-full bg-stone-900 transition-[width] duration-200 dark:bg-stone-100"
                  style={{ width: `${Math.max(2, updateState.progressPercent ?? 0)}%` }}
                />
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                已下载 {updateState.downloadedBytes.toLocaleString()} /{" "}
                {Math.max(updateState.totalBytes, 0).toLocaleString()} 字节
              </div>
            </div>
          ) : null}

          {updateState?.releaseNotes ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">
                Release Notes
              </div>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-xs leading-6 text-stone-600 dark:border-stone-700 dark:bg-stone-900/70 dark:text-stone-300">
                <pre className="whitespace-pre-wrap break-words font-sans">
                  {updateState.releaseNotes}
                </pre>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full border-stone-300/60 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
            onClick={() => void checkDesktopUpdate()}
            disabled={checkingUpdate || installingUpdate}
          >
            {checkingUpdate || updateState?.status === "checking" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            检查更新
          </Button>

          <Button
            type="button"
            className="h-9 rounded-full bg-gradient-to-b from-stone-900 to-stone-800 px-4 text-sm font-medium text-white shadow-md transition-all hover:shadow-lg dark:from-stone-100 dark:to-stone-200 dark:text-stone-900"
            onClick={() => void downloadAndInstallUpdate()}
            disabled={
              !desktopUpdaterAvailable ||
              checkingUpdate ||
              installingUpdate ||
              !updateState ||
              !["update-available", "downloading", "installer-ready"].includes(updateState.status)
            }
          >
            {installingUpdate || updateState?.status === "downloading" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {updateState?.status === "installer-ready" ? "打开安装包" : "下载并安装"}
          </Button>

          <Button
            asChild
            type="button"
            variant="outline"
            className="h-9 rounded-full border-stone-300/60 bg-white px-3 text-sm font-medium text-stone-700 shadow-sm transition-all hover:border-stone-400 hover:bg-stone-50 hover:shadow dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
          >
            <a
              href={updateState?.releasePageUrl || "https://github.com/Hopesy/Eidos/releases"}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4" />
              打开 Release
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
