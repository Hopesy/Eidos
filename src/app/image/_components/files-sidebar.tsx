"use client";

import { useEffect, useState } from "react";
import { FileImage, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppImage as Image } from "@/components/app-image";
import { getDesktopShellApi } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

type ImageFileItem = {
  id: string;
  role: string;
  file_path: string;
  public_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

async function fetchImageFiles() {
  const response = await fetch("/api/image-files");
  if (!response.ok) {
    throw new Error("读取图片文件列表失败");
  }
  const data = await response.json() as { items: ImageFileItem[] };
  return data.items;
}

async function openDataDirInBrowserMode() {
  const response = await fetch("/api/system/open-data-dir", {
    method: "POST",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: { error?: string } } | null;
    throw new Error(payload?.detail?.error || "打开文件夹失败");
  }
  return response.json() as Promise<{ opened: boolean; path: string }>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatFileTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const roleColorMap: Record<string, string> = {
  result: "bg-emerald-500",
  source: "bg-blue-500",
  mask: "bg-purple-500",
  upload: "bg-amber-500",
};

export type FilesSidebarProps = {
  onOpenImage?: (publicPath: string) => void;
};

export function FilesSidebar({ onOpenImage }: FilesSidebarProps) {
  const [files, setFiles] = useState<ImageFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const desktopShell = getDesktopShellApi();

  const loadFiles = async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const items = await fetchImageFiles();
      setFiles(items);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取图片文件失败";
      toast.error(message);
    } finally {
      if (isRefresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadFiles();
  }, []);

  const handleOpenFolder = async () => {
    try {
      if (desktopShell) {
        await desktopShell.openDataDir();
      } else {
        await openDataDirInBrowserMode();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开文件夹失败";
      toast.error(message);
    }
  };

  return (
    <aside className="order-3 w-full overflow-hidden rounded-2xl border border-stone-200/60 bg-gradient-to-b from-white to-stone-50/30 shadow-lg lg:order-none lg:h-full lg:min-h-0 dark:border-stone-700 dark:from-stone-900 dark:to-stone-800/30">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-stone-200/40 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-800/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileImage className="size-3.5 text-stone-400 dark:text-stone-500" />
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">文件</span>
              <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
                {files.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleOpenFolder()}
                className="inline-flex size-6 items-center justify-center rounded-lg text-stone-400 transition-all hover:bg-stone-200/50 hover:text-stone-500 dark:text-stone-500 dark:hover:bg-stone-700/50 dark:hover:text-stone-400"
                title="打开文件夹"
              >
                <FolderOpen className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => void loadFiles(true)}
                disabled={isRefreshing}
                className="inline-flex size-6 items-center justify-center rounded-lg text-stone-400 transition-all hover:bg-stone-200/50 hover:text-stone-500 disabled:pointer-events-none disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-700/50 dark:hover:text-stone-400"
                title="刷新列表"
              >
                <RefreshCw className={cn("size-3", isRefreshing && "animate-spin")} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-stone-400 dark:text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              读取中…
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
              <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                <FileImage className="size-5 text-stone-400 dark:text-stone-500" />
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">还没有图片文件</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group relative overflow-hidden rounded-xl bg-white/60 transition-all duration-200 hover:bg-white hover:shadow-md dark:bg-stone-800/60 dark:hover:bg-stone-800"
                >
                  <button
                    type="button"
                    onClick={() => onOpenImage?.(file.public_path)}
                    className="flex w-full gap-3 p-2.5 text-left"
                  >
                    <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-stone-100 to-stone-200/50 shadow-sm ring-1 ring-stone-900/5 dark:from-stone-700 dark:to-stone-800/50 dark:ring-stone-700">
                      <Image
                        src={file.public_path}
                        alt={file.file_path}
                        className="h-full w-full object-cover"
                      />
                      <div className={cn("absolute left-1 top-1 size-2 rounded-full shadow-lg", roleColorMap[file.role] || "bg-stone-400")} />
                    </div>

                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="truncate text-xs font-medium text-stone-700 dark:text-stone-300" title={file.file_path}>
                        {file.file_path.split("/").pop()}
                      </div>
                      <div className="mt-1 text-[10px] text-stone-400 dark:text-stone-500">
                        {formatFileSize(file.size_bytes)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
                        {formatFileTime(file.created_at)}
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
