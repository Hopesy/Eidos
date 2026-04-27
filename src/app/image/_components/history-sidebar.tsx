"use client";

import { History, LoaderCircle, MessageSquarePlus, Sparkles, Trash2, X } from "lucide-react";

import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImageConversation, ImageMode } from "@/store/image-conversations";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildConversationPreviewSource(conversation: ImageConversation) {
  const turns = conversation.turns ?? [];
  // 从最新一轮开始找成功的图片
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const successImage = (turn.images ?? []).find(
      (image) => image.status === "success" && (image.url || image.b64_json),
    );
    if (successImage?.url) {
      return successImage.url;
    }
    if (successImage?.b64_json) {
      return `data:image/png;base64,${successImage.b64_json}`;
    }
  }
  const firstSourceImage = conversation.sourceImages?.find((item) => item.role === "image");
  return firstSourceImage?.dataUrl || "";
}

const modeLabelMap: Record<ImageMode, string> = {
  generate: "生成",
  edit: "编辑",
  upscale: "放大",
};

const modeColorMap: Record<ImageMode, string> = {
  generate: "bg-gradient-to-br from-violet-500 to-purple-600 text-white",
  edit: "bg-gradient-to-br from-sky-500 to-blue-600 text-white",
  upscale: "bg-gradient-to-br from-amber-500 to-orange-600 text-white",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type HistorySidebarProps = {
  conversations: ImageConversation[];
  selectedConversationId: string | null;
  isLoadingHistory: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateDraft: () => void;
  onClearHistory: () => void;
};

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export function HistorySidebar({
  conversations,
  selectedConversationId,
  isLoadingHistory,
  onSelect,
  onDelete,
  onCreateDraft,
  onClearHistory,
}: HistorySidebarProps) {
  return (
    <aside className="order-2 w-full overflow-hidden rounded-2xl border border-stone-200/60 bg-gradient-to-b from-white to-stone-50/30 shadow-lg lg:order-none lg:h-full lg:min-h-0 dark:border-stone-700 dark:from-stone-900 dark:to-stone-800/30">
      <div className="flex h-full min-h-0 flex-col">
        {/* 头部 */}
        <div className="border-b border-stone-200/60 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/80">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-stone-900 to-stone-700 shadow-sm dark:from-stone-100 dark:to-stone-300">
                <History className="size-4 text-white dark:text-stone-900" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-stone-900 dark:text-stone-100">历史记录</span>
                <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-stone-100 dark:text-stone-900">
                  {conversations.length}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClearHistory}
              disabled={conversations.length === 0}
              className="inline-flex size-8 items-center justify-center rounded-lg text-stone-400 transition-all hover:bg-rose-50 hover:text-rose-600 hover:shadow-sm disabled:pointer-events-none disabled:opacity-40 dark:text-stone-500 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
              title="清空历史"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <Button
            className="mt-3 h-10 w-full rounded-xl bg-gradient-to-br from-stone-900 to-stone-800 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg dark:from-stone-100 dark:to-stone-200 dark:text-stone-900"
            onClick={onCreateDraft}
          >
            <MessageSquarePlus className="size-4" />
            新建对话
          </Button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-stone-400 dark:text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              读取中…
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
              <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                <History className="size-5 text-stone-400 dark:text-stone-500" />
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">还没有历史记录</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                const previewSrc = buildConversationPreviewSource(conversation);
                const latestTurn = conversation.turns?.[conversation.turns.length - 1] ?? null;
                const isGenerating = latestTurn?.status === "generating";
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      "group relative overflow-hidden rounded-xl transition-all duration-200",
                      active
                        ? "bg-white shadow-lg ring-2 ring-stone-900/10 dark:bg-stone-800 dark:ring-stone-700"
                        : "bg-white/60 hover:bg-white hover:shadow-md dark:bg-stone-800/60 dark:hover:bg-stone-800",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className="flex w-full gap-3 p-1.5 pr-9 text-left"
                    >
                      {/* 缩略图 */}
                      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-stone-100 to-stone-200/50 shadow-sm ring-1 ring-stone-900/5 dark:from-stone-700 dark:to-stone-800/50 dark:ring-stone-700">
                        {previewSrc ? (
                          <Image
                            src={previewSrc}
                            alt={conversation.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <History className="size-5 text-stone-400 dark:text-stone-500" />
                        )}
                        {isGenerating && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-stone-900/80">
                            <div className="relative flex items-center justify-center">
                              <div className="absolute size-8 animate-ping rounded-full bg-stone-300 opacity-15 dark:bg-stone-600" />
                              <div className="absolute size-6 animate-pulse rounded-full bg-stone-400 opacity-20 dark:bg-stone-500" />
                              <Sparkles className="relative size-4 animate-pulse text-stone-500 dark:text-stone-400" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 文字区 */}
                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="line-clamp-2 text-xs font-semibold leading-snug text-stone-900 dark:text-stone-100">
                          {conversation.title}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                          <span>{formatConversationTime(conversation.createdAt)}</span>
                        </div>
                      </div>
                    </button>

                    {/* 删除按钮 */}
                    <button
                      type="button"
                      onClick={() => onDelete(conversation.id)}
                      className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-stone-900/40 text-white/80 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-stone-900/60 hover:text-white group-hover:opacity-100 dark:bg-stone-100/40 dark:text-stone-900/80 dark:hover:bg-stone-100/60 dark:hover:text-stone-900"
                      aria-label="删除会话"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

