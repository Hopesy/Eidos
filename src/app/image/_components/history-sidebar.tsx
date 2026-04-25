"use client";

import { History, LoaderCircle, MessageSquarePlus, Trash2 } from "lucide-react";

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
  if (diffMins < 60) return `${diffMins}m前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h前`;
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
  generate: "bg-violet-50 text-violet-600",
  edit: "bg-sky-50 text-sky-600",
  upscale: "bg-amber-50 text-amber-600",
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
    <aside className="order-2 w-full overflow-hidden rounded-[18px] border border-stone-200 bg-[#f8f8f7] shadow-[0_8px_30px_rgba(15,23,42,0.04)] lg:order-none lg:min-h-0">
      <div className="flex h-full min-h-0 flex-col">
        {/* 头部 */}
        <div className="border-b border-stone-200/80 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-stone-900">历史</span>
              <span className="min-w-[20px] rounded-full bg-stone-200/80 px-1.5 py-0.5 text-center text-[11px] font-medium text-stone-500">
                {conversations.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClearHistory}
                disabled={conversations.length === 0}
                className="inline-flex size-7 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-200/70 hover:text-stone-700 disabled:pointer-events-none disabled:opacity-40"
                title="清空历史"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          <Button
            className="mt-2.5 h-9 w-full rounded-xl bg-stone-950 text-xs text-white hover:bg-stone-800"
            onClick={onCreateDraft}
          >
            <MessageSquarePlus className="size-3.5" />
            新建对话
          </Button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs text-stone-400">
              <LoaderCircle className="size-3.5 animate-spin" />
              读取中…
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs leading-6 text-stone-400">
              还没有历史记录
            </div>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                const previewSrc = buildConversationPreviewSource(conversation);
                const latestTurn = conversation.turns?.[conversation.turns.length - 1] ?? null;
                const isGenerating = latestTurn?.status === "generating";
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      "group relative rounded-[14px] transition-all",
                      active
                        ? "bg-white shadow-sm ring-1 ring-stone-200/80"
                        : "hover:bg-white/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className="flex w-full items-center gap-2.5 p-2 pr-8 text-left"
                    >
                      {/* 缩略图 */}
                      <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-stone-100">
                        {previewSrc ? (
                          <Image
                            src={previewSrc}
                            alt={conversation.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <History className="size-3.5 text-stone-400" />
                        )}
                        {isGenerating && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                            <LoaderCircle className="size-3.5 animate-spin text-stone-600" />
                          </div>
                        )}
                      </div>

                      {/* 文字区 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", modeColorMap[conversation.mode])}>
                            {modeLabelMap[conversation.mode]}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-stone-400">
                            {formatConversationTime(conversation.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[13px] font-medium leading-snug text-stone-800">
                          {conversation.title}
                        </div>
                      </div>
                    </button>

                    {/* 删除按钮 */}
                    <button
                      type="button"
                      onClick={() => onDelete(conversation.id)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded-lg text-stone-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                      aria-label="删除会话"
                    >
                      <Trash2 className="size-3.5" />
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

