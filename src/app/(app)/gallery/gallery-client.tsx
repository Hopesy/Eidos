"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  ExternalLink,
  GalleryThumbnails,
  RotateCcw,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { AppImage as Image } from "@/components/app-image";
import { deleteImageFavorite, type GalleryImageItem } from "@/lib/api";
import { cn } from "@/lib/utils";

type GalleryClientProps = {
  initialItems: GalleryImageItem[];
};

type GallerySortMode = "newest" | "oldest";

const modeLabels: Record<GalleryImageItem["mode"], string> = {
  generate: "生成",
  edit: "编辑",
  upscale: "增强",
};

const sortOptions: Array<{ value: GallerySortMode; label: string }> = [
  { value: "newest", label: "最新" },
  { value: "oldest", label: "最早" },
];

function formatDateTime(value: string) {
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

function searchText(item: GalleryImageItem) {
  return [
    item.title,
    item.prompt,
    item.revisedPrompt,
    item.model,
    item.imageRatio,
    item.imageQuality,
    item.imageFormat,
    modeLabels[item.mode],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function GalleryClient({ initialItems }: GalleryClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<GalleryImageItem[]>(initialItems);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<GallerySortMode>("newest");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items
      .filter((item) => !normalizedQuery || searchText(item).includes(normalizedQuery))
      .sort((a, b) =>
        sortMode === "newest"
          ? b.createdAt.localeCompare(a.createdAt)
          : a.createdAt.localeCompare(b.createdAt),
      );
  }, [items, query, sortMode]);

  const handleCopyPrompt = async (item: GalleryImageItem) => {
    if (!item.prompt.trim()) {
      toast.error("当前收藏没有可复制的提示词");
      return;
    }
    try {
      await navigator.clipboard.writeText(item.prompt);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败，请检查剪贴板权限");
    }
  };

  const handleRemoveFavorite = async (item: GalleryImageItem) => {
    setItems((prev) => prev.filter((current) => current.favoriteId !== item.favoriteId));
    try {
      await deleteImageFavorite(item.favoriteId);
      toast.success("已取消收藏");
    } catch (error) {
      setItems((prev) => [item, ...prev.filter((current) => current.favoriteId !== item.favoriteId)]);
      toast.error(error instanceof Error ? error.message : "取消收藏失败");
    }
  };

  const handleReuseConfig = (item: GalleryImageItem) => {
    router.push(`/image?favorite=${encodeURIComponent(item.favoriteId)}`);
  };

  const handleOpenConversation = (item: GalleryImageItem) => {
    router.push(`/image?conversation=${encodeURIComponent(item.conversationId)}`);
  };

  return (
    <section className="flex h-full min-h-[calc(100dvh-0.75rem)] flex-col overflow-hidden rounded-[18px] border border-stone-200 bg-[#fcfcfb] text-stone-900 shadow-[0_14px_40px_rgba(15,23,42,0.05)] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100">
      <header className="shrink-0 border-b border-stone-200/80 bg-[#f7f7f5]/95 px-4 py-4 backdrop-blur-xl sm:px-6 dark:border-stone-800 dark:bg-stone-950/92">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-end gap-4">
              <h1 className="text-[28px] font-semibold tracking-tight text-stone-950 sm:text-[34px] dark:text-stone-50">
                收藏画廊
              </h1>
              <span className="pb-1 text-sm font-medium text-stone-400 dark:text-stone-500">
                {items.length} 张收藏
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center xl:w-auto xl:min-w-[520px]">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索提示词、模型或标题"
                className="h-9 w-full rounded-full border border-stone-200 bg-white/85 pl-9 pr-3 text-sm text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900/85 dark:text-stone-100 dark:focus:border-stone-500"
              />
            </label>

            <div className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white/75 p-1 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-stone-700 dark:bg-stone-900/75">
              {sortOptions.map((option) => {
                const active = sortMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSortMode(option.value)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded-full px-3 text-xs font-medium transition",
                      active
                        ? "bg-stone-950 text-white shadow-sm dark:bg-stone-100 dark:text-stone-950"
                        : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-6">
        {filteredItems.length > 0 ? (
          <div className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6">
            <AnimatePresence initial={false}>
              {filteredItems.map((item, index) => {
                return (
                  <motion.article
                    key={item.favoriteId}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.015, 0.12) }}
                    className="group mb-3 inline-block w-full overflow-hidden rounded-[14px] break-inside-avoid border border-stone-200 bg-white shadow-[0_14px_34px_-30px_rgba(15,23,42,0.65)] transition dark:border-stone-800 dark:bg-stone-900"
                  >
                    <div className="relative overflow-hidden bg-stone-100 dark:bg-stone-900">
                      <Image
                        src={item.imageUrl}
                        alt={item.title || "收藏图片"}
                        className="block h-auto w-full bg-stone-100 object-cover transition duration-500 group-hover:scale-[1.015] dark:bg-stone-900"
                        loading="lazy"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950/74 via-stone-950/16 to-transparent opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" />
                      <div className="absolute inset-2 flex flex-col justify-between opacity-100 transition sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">
                        <div className="w-fit max-w-full truncate rounded-full bg-stone-950/68 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                          {formatDateTime(item.createdAt)}
                        </div>
                        <div className="flex w-fit shrink-0 items-center gap-0.5 rounded-full bg-stone-950/68 p-1 backdrop-blur">
                          <button
                            type="button"
                            onClick={() => void handleCopyPrompt(item)}
                            className="inline-flex size-6 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                            title="复制提示词"
                            aria-label="复制提示词"
                          >
                            <Copy className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReuseConfig(item)}
                            className="inline-flex size-6 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                            title="用配置生成"
                            aria-label="用配置生成"
                          >
                            <WandSparkles className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenConversation(item)}
                            className="inline-flex size-6 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                            title="打开原会话"
                            aria-label="打开原会话"
                          >
                            <ExternalLink className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemoveFavorite(item)}
                            className="inline-flex size-6 items-center justify-center rounded-full text-white/80 transition hover:bg-rose-500/25 hover:text-white"
                            title="取消收藏"
                            aria-label="取消收藏"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex min-h-[52vh] items-center justify-center">
            <div className="flex max-w-[420px] flex-col items-center text-center">
              <div className="flex size-14 items-center justify-center rounded-[20px] border border-stone-200 bg-white text-stone-400 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-500">
                {items.length === 0 ? <GalleryThumbnails className="size-6" /> : <Search className="size-6" />}
              </div>
              <h2 className="mt-4 text-base font-semibold text-stone-900 dark:text-stone-100">
                {items.length === 0 ? "还没有收藏图片" : "没有匹配结果"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
                {items.length === 0
                  ? "结果图会按收藏时间汇集在这里。"
                  : "调整搜索词或筛选条件后再查看。"}
              </p>
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => router.push("/image")}
                  className="mt-5 inline-flex h-9 items-center gap-2 rounded-full bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200"
                >
                  <RotateCcw className="size-4" />
                  返回工作台
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
