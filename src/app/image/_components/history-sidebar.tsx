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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildConversationPreviewSource(conversation: ImageConversation) {
  const latestSuccessfulImage = conversation.images.find(
    (image) => image.status === "success" && image.b64_json,
  );
  if (latestSuccessfulImage?.b64_json) {
    return `data:image/png;base64,${latestSuccessfulImage.b64_json}`;
  }
  const firstSourceImage = conversation.sourceImages?.find((item) => item.role === "image");
  return firstSourceImage?.dataUrl || "";
}

const modeLabelMap: Record<ImageMode, string> = {
  generate: "生成",
  edit: "编辑",
  upscale: "放大",
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
    <aside className="order-2 overflow-hidden rounded-[28px] border border-stone-200 bg-[#f8f8f7] shadow-[0_8px_30px_rgba(15,23,42,0.04)] lg:order-none lg:min-h-0">
      <div className="flex h-full min-h-0 flex-col">
        {/* 头部 */}
        <div className="border-b border-stone-200/80 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-stone-900">历史记录</h2>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-500 shadow-sm">
              {conversations.length}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button
              className="h-11 flex-1 rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
              onClick={onCreateDraft}
            >
              <MessageSquarePlus className="size-4" />
              新建对话
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-2xl border-stone-200 bg-white px-3 text-stone-600 hover:bg-stone-50"
              onClick={onClearHistory}
              disabled={conversations.length === 0}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取会话记录
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-4 text-sm leading-6 text-stone-500">
              还没有历史记录。创建第一条图片任务后，会在这里保留缩略图和提示词摘要。
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                const previewSrc = buildConversationPreviewSource(conversation);
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      "group rounded-[22px] border p-2 transition",
                      active
                        ? "border-stone-200 bg-white shadow-sm"
                        : "border-transparent bg-transparent hover:border-stone-200/80 hover:bg-white/70",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-stone-100">
                          {previewSrc ? (
                            <Image
                              src={previewSrc}
                              alt={conversation.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <History className="size-4 text-stone-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                              {modeLabelMap[conversation.mode]}
                            </span>
                            <span className="truncate text-xs text-stone-400">
                              {formatConversationTime(conversation.createdAt)}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-sm font-medium text-stone-800">
                            {conversation.title}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">
                            {conversation.prompt || "无额外提示词"}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(conversation.id)}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-stone-400 opacity-100 transition hover:bg-stone-100 hover:text-rose-500 lg:opacity-0 lg:group-hover:opacity-100"
                        aria-label="删除会话"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
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
