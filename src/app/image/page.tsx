"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { toast } from "sonner";

import { ImageEditModal } from "@/components/image-edit-modal";
import { ImagePreviewModal } from "@/components/image-preview-modal";
import {
  ComposerPanel,
  type GenerationOption,
  type ImageModelOption,
  type ModeOption,
  type ToolbarImageSize,
} from "./_components/composer-panel";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ConversationTurn } from "./_components/conversation-turn";
import { EmptyState, type InspirationExample } from "./_components/empty-state";
import { HistorySidebar } from "./_components/history-sidebar";
import { FilesSidebar } from "./_components/files-sidebar";
import {
  editImage,
  fetchAccounts,
  fetchRecoverableImageTasks,
  generateImage,
  recoverImageTask,
  upscaleImage,
  type Account,
  type ImageGenerationQuality,
  type ImageGenerationSize,
  type ImageModel,
  type RecoverableImageTaskItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  clearImageConversations,
  deleteImageConversation,
  listImageConversations,
  normalizeConversation,
  saveImageConversation,
  updateImageConversation,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import {
  finishImageTask,
  isImageTaskActive,
  listActiveImageTasks,
  startImageTask,
  subscribeImageTasks,
} from "@/store/image-active-tasks";
import { getCachedImageWorkspaceState, setCachedImageWorkspaceState } from "@/store/image-workspace-cache";
import { ApiRequestError } from "@/lib/request";
import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";

const imageModelOptions: Array<{ label: string; value: ImageModel }> = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "gpt-image-1", value: "gpt-image-1" },
];

const modeOptions: Array<{ label: string; value: ImageMode; description: string }> = [
  { label: "生成", value: "generate", description: "提示词生成新图，也可上传参考图辅助生成" },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
  { label: "放大", value: "upscale", description: "提升清晰度并放大细节" },
];

const upscaleOptions = ["2x", "4x", "6x", "8x"];

const imageSizeOptions: GenerationOption<ToolbarImageSize>[] = [
  { label: "Auto", value: "auto" },
  { label: "1:1 方图", value: "1024x1024" },
  { label: "3:2 横图", value: "1536x1024" },
  { label: "2:3 竖图", value: "1024x1536" },
  { label: "16:9 横屏", value: "1792x1024" },
  { label: "9:16 竖屏", value: "1024x1792" },
];

const imageQualityOptions: GenerationOption<ImageGenerationQuality>[] = [
  { label: "2K", value: "medium" },
  { label: "4K", value: "high" },
];

function mapToolbarImageSizeToApiSize(size: ToolbarImageSize): ImageGenerationSize {
  if (size === "1792x1024") {
    return "1536x1024";
  }
  if (size === "1024x1792") {
    return "1024x1536";
  }
  return size;
}

const inspirationExamples: InspirationExample[] = [
  {
    id: "stellar-poster",
    title: "卡芙卡轮廓宇宙海报",
    prompt:
      "请根据【主题：崩坏星穹铁道，角色卡芙卡】自动生成一张高审美的轮廓宇宙收藏版叙事海报风格作品。不要将画面局限于固定器物或常见容器，不要优先默认瓶子、沙漏、玻璃罩、怀表之类的常规载体，而是由 AI 根据主题自行判断并选择一个最契合、最有象征意义、轮廓最强、最适合承载完整叙事世界的主轮廓载体。这个主轮廓可以是器物、建筑、门、塔、拱门、穹顶、楼梯井、长廊、雕像、侧脸、眼睛、手掌、头骨、羽翼、面具、镜面、王座、圆环、裂缝、光幕、阴影、几何结构、空间切面、舞台框景、抽象符号或其他更有创意与主题代表性的视觉轮廓，要求合理布局。优先选择最能放大主题气质的轮廓。画面的核心不是简单把世界装进某个物体里，而是让完整的主题世界自然生长在这个主轮廓之中。主轮廓必须清晰、优雅、有辨识度。整体构图需要具有强烈的收藏版海报气质与高级设计感。风格融合收藏版电影海报构图、高级叙事型视觉设计、梦幻水彩质感与纸张印刷品气质。色彩由 AI 根据主题自动判断。",
    hint: "适合高审美叙事海报、角色宇宙主题视觉、收藏版概念海报。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-[#17131f] via-[#4c2d45] to-[#b79b8b]",
  },
  {
    id: "qinghua-museum-infographic",
    title: "青花瓷博物馆图鉴",
    prompt:
      "请根据青花瓷自动生成一张博物馆图鉴式中文拆解信息图。要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。整体风格应为国家博物馆展板、历史服饰图鉴、文博专题信息图。背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。所有文字必须为简体中文。",
    hint: "适合文博专题、器物拆解、中文信息图和展板式视觉。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-[#0d2f5f] via-[#3a6ea5] to-[#e7dcc4]",
  },
  {
    id: "editorial-fashion",
    title: "周芷若联动宣传图",
    prompt:
      "《倚天屠龙记》周芷若的维秘联动活动宣传图，人物占画面 80% 以上，周芷若在古风古城城墙上，优雅侧身回眸姿态，高品质真人级 3D 古风游戏截图风格，电影级光影，背景为夜晚古城墙，青砖城垛、灯笼照明、月光洒落，高细节，8K 品质。",
    hint: "适合古风角色联动、游戏活动主视觉、电影感人物宣传图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-zinc-900 via-rose-800 to-amber-500",
  },
  {
    id: "forza-horizon-shenzhen",
    title: "地平线 8 深圳实机图",
    prompt:
      "创作一张图片为《极限竞速 地平线 8》的游戏实机截图，游戏背景设为中国，背景城市为深圳，时间设定为 2028 年。画面需要体现真实次世代开放世界赛车游戏的实机演出效果，包含具有深圳辨识度的城市天际线。构图中在合适位置放置《极限竞速 地平线 8》的 logo 及宣传文案。要求 8K 超高清，电影级光影。",
    hint: "适合游戏主视觉、次世代赛车截图、城市宣传感概念图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-slate-950 via-cyan-900 to-orange-500",
  },
];

type ActiveRequestState = {
  conversationId: string;
  turnId: string;
  mode: import("@/store/image-conversations").ImageMode;
  count: number;
  variant: "standard" | "selection-edit";
  imageId?: string;
};

function buildConversationTitle(mode: ImageMode, prompt: string, scale: string) {
  const trimmed = prompt.trim();
  const prefix = mode === "generate" ? "生成" : mode === "edit" ? "编辑" : `放大 ${scale}`;
  if (!trimmed) {
    return prefix;
  }
  if (trimmed.length <= 8) {
    return `${prefix} · ${trimmed}`;
  }
  return `${prefix} · ${trimmed.slice(0, 8)}...`;
}

function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用" && account.status !== "异常");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

async function normalizeConversationHistory(items: ImageConversation[]) {
  const normalized = items.map((item) => {
    let changed = false;
    const turns = (item.turns ?? []).map((turn) => {
      if (turn.status !== "generating" || isImageTaskActive(item.id, turn.id)) {
        return turn;
      }

      changed = true;
      const errorMessage = turn.images.some((image) => image.status === "success")
        ? turn.error || "任务已中断"
        : "页面已刷新，任务已中断";

      return {
        ...turn,
        status: "error" as const,
        error: errorMessage,
        images: turn.images.map((image) =>
          image.status === "loading"
            ? {
              ...image,
              status: "error" as const,
              error: "页面已刷新，任务已中断",
            }
            : image,
        ),
      };
    });

    const conversation = normalizeConversation(
      changed
        ? {
          ...item,
          turns,
        }
        : item,
    );

    return { conversation, changed };
  });

  await Promise.all(
    normalized
      .filter((item) => item.changed)
      .map((item) => saveImageConversation(item.conversation)),
  );

  return normalized.map((item) => item.conversation);
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildImageDataUrl(image: StoredImage) {
  if (image.url) {
    return image.url;
  }
  if (!image.b64_json) {
    return "";
  }
  return `data:image/png;base64,${image.b64_json}`;
}

function getLatestSuccessfulImage(turns: ImageConversationTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const images = Array.isArray(turn.images) ? turn.images : [];
    for (let imageIndex = images.length - 1; imageIndex >= 0; imageIndex -= 1) {
      const image = images[imageIndex];
      if (image.status === "success" && (image.url || image.b64_json)) {
        return image;
      }
    }
  }
  return null;
}

function createLoadingImages(count: number, conversationId: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${conversationId}-${index}`,
    status: "loading" as const,
  }));
}

function createConversationTurn(payload: {
  turnId: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  imageSize?: ImageGenerationSize;
  imageQuality?: ImageGenerationQuality;
  count: number;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: "generating" | "success" | "error";
  error?: string;
}): ImageConversationTurn {
  return {
    id: payload.turnId,
    title: payload.title,
    mode: payload.mode,
    prompt: payload.prompt,
    model: payload.model,
    imageSize: payload.imageSize,
    imageQuality: payload.imageQuality,
    count: payload.count,
    scale: payload.scale,
    sourceImages: payload.sourceImages ?? [],
    images: payload.images,
    createdAt: payload.createdAt,
    status: payload.status,
    error: payload.error,
  };
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

function createSourceImageFromResult(image: StoredImage, name: string, hiddenInConversation = false): StoredSourceImage | null {
  const dataUrl = buildImageDataUrl(image);
  if (!dataUrl) {
    return null;
  }
  return {
    id: makeId(),
    role: "image",
    name,
    dataUrl,
    hiddenInConversation,
    image_id: image.image_id,
    file_path: image.file_path,
    file_id: image.file_id,
    gen_id: image.gen_id,
    response_id: image.response_id,
    image_generation_call_id: image.image_generation_call_id,
    conversation_id: image.conversation_id,
    parent_message_id: image.parent_message_id,
    source_account_id: image.source_account_id,
  };
}

function buildSourceReference(source: StoredSourceImage | null | undefined) {
  if (!source) {
    return null;
  }
  const originalFileId = String(source.file_id || "").trim();
  const originalGenId = String(source.gen_id || source.response_id || "").trim();
  const sourceAccountId = String(source.source_account_id || "").trim();
  if (!originalFileId || !sourceAccountId || !originalGenId) {
    return null;
  }
  return {
    original_file_id: originalFileId,
    original_gen_id: originalGenId,
    previous_response_id: String(source.response_id || "").trim() || undefined,
    image_generation_call_id: String(source.image_generation_call_id || "").trim() || undefined,
    conversation_id: String(source.conversation_id || "").trim() || undefined,
    parent_message_id: String(source.parent_message_id || "").trim() || undefined,
    source_account_id: sourceAccountId,
  };
}

function mergeResultImages(
  conversationId: string,
  items: Array<{
    b64_json?: string;
    url?: string;
    image_id?: string;
    file_path?: string;
    revised_prompt?: string;
    text?: string;
    file_id?: string;
    gen_id?: string;
    response_id?: string;
    image_generation_call_id?: string;
    conversation_id?: string;
    parent_message_id?: string;
    source_account_id?: string;
  }>,
  expected: number,
) {
  const results: StoredImage[] = items.map((item, index) => createResultImage(`${conversationId}-${index}`, item));

  if (expected > results.length) {
    for (let index = results.length; index < expected; index += 1) {
      results.push({
        id: `${conversationId}-${index}`,
        status: "error",
        error: "未返回足够数量的图片",
      });
    }
  }

  return results;
}

function createResultImage(
  id: string,
  item: {
    b64_json?: string;
    url?: string;
    image_id?: string;
    file_path?: string;
    revised_prompt?: string;
    text?: string;
    file_id?: string;
    gen_id?: string;
    response_id?: string;
    image_generation_call_id?: string;
    conversation_id?: string;
    parent_message_id?: string;
    source_account_id?: string;
  } | null | undefined,
): StoredImage {
  if (item?.url || item?.b64_json) {
    return {
      id,
      status: "success",
      ...(item.url ? { url: item.url } : { b64_json: item.b64_json }),
      image_id: item.image_id,
      file_path: item.file_path,
      revised_prompt: item.revised_prompt,
      file_id: item.file_id,
      gen_id: item.gen_id,
      response_id: item.response_id,
      image_generation_call_id: item.image_generation_call_id,
      conversation_id: item.conversation_id,
      parent_message_id: item.parent_message_id,
      source_account_id: item.source_account_id,
      failureKind: undefined,
      retryAction: undefined,
      retryable: undefined,
      stage: undefined,
      upstreamConversationId: undefined,
    };
  }

  if (item?.text) {
    return {
      id,
      status: "success",
      text: item.text,
    };
  }

  return {
    id,
    status: "error",
    error: "接口没有返回图片数据",
  };
}

function patchRetriedImages(
  existingImages: StoredImage[],
  retryIndexes: number[],
  items: Array<{
    b64_json?: string;
    url?: string;
    image_id?: string;
    file_path?: string;
    revised_prompt?: string;
    text?: string;
    file_id?: string;
    gen_id?: string;
    response_id?: string;
    image_generation_call_id?: string;
    conversation_id?: string;
    parent_message_id?: string;
    source_account_id?: string;
  }>,
) {
  const nextImages = existingImages.map((image) => ({ ...image }));
  retryIndexes.forEach((slotIndex, resultIndex) => {
    const current = nextImages[slotIndex];
    if (!current) {
      return;
    }
    nextImages[slotIndex] = createResultImage(current.id, items[resultIndex]);
  });

  if (items.length < retryIndexes.length) {
    for (let index = items.length; index < retryIndexes.length; index += 1) {
      const slotIndex = retryIndexes[index];
      const current = nextImages[slotIndex];
      if (!current) {
        continue;
      }
      nextImages[slotIndex] = {
        ...current,
        status: "error",
        error: "未返回足够数量的图片",
      };
    }
  }

  return nextImages;
}

function countFailures(images: StoredImage[]) {
  return images.filter((image) => image.status === "error").length;
}

function findRecoverableTurn(conversations: ImageConversation[]) {
  return conversations
    .flatMap((conversation) =>
      (conversation.turns ?? []).map((turn) => ({
        conversationId: conversation.id,
        turn,
      })),
    )
    .filter(({ turn }) =>
      turn.status === "error" &&
      Boolean(turn.retryable) &&
      Boolean(turn.upstreamConversationId) &&
      (turn.retryAction === "resume_polling" || turn.retryAction === "retry_download"),
    )
    .sort((a, b) => b.turn.createdAt.localeCompare(a.turn.createdAt))[0] ?? null;
}

function findRecoverableTaskCandidate(
  tasks: RecoverableImageTaskItem[],
  conversations: ImageConversation[],
) {
  const byConversation = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const sortedTasks = [...tasks].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  for (const task of sortedTasks) {
    const conversationId = String(task.localConversationId || "").trim();
    const turnId = String(task.localTurnId || "").trim();
    if (!conversationId || !turnId) {
      continue;
    }
    const conversation = byConversation.get(conversationId);
    if (!conversation) {
      continue;
    }
    const turn = (conversation.turns ?? []).find((item) => item.id === turnId);
    if (!turn || turn.status !== "error") {
      continue;
    }
    const mergedTurn: ImageConversationTurn = {
      ...turn,
      mode: task.mode || turn.mode,
      prompt: String(task.prompt || task.revisedPrompt || turn.prompt || ""),
      model: (String(task.model || turn.model || "gpt-image-1") || "gpt-image-1") as ImageModel,
      failureKind: String(task.failureKind || turn.failureKind || "").trim() || turn.failureKind,
      retryAction: String(task.retryAction || turn.retryAction || "").trim() || turn.retryAction,
      retryable: typeof task.retryable === "boolean" ? task.retryable : turn.retryable,
      stage: String(task.stage || turn.stage || "").trim() || turn.stage,
      upstreamConversationId:
        String(task.upstreamConversationId || turn.upstreamConversationId || "").trim() || turn.upstreamConversationId,
      upstreamResponseId:
        String(task.upstreamResponseId || turn.upstreamResponseId || "").trim() || turn.upstreamResponseId,
      imageGenerationCallId:
        String(task.imageGenerationCallId || turn.imageGenerationCallId || "").trim() || turn.imageGenerationCallId,
      sourceAccountId:
        String(task.sourceAccountId || turn.sourceAccountId || "").trim() || turn.sourceAccountId,
      fileIds: Array.isArray(task.fileIds) && task.fileIds.length > 0 ? task.fileIds : turn.fileIds,
      error: String(task.error || turn.error || "").trim() || turn.error,
    };
    return {
      task,
      conversationId,
      turn: mergedTurn,
    };
  }

  return null;
}

function formatProcessingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildWaitingDots(totalSeconds: number) {
  return ".".repeat((totalSeconds % 3) + 1);
}

function buildProcessingStatus(
  mode: ImageMode,
  elapsedSeconds: number,
  count: number,
  variant: ActiveRequestState["variant"],
) {
  if (mode === "generate") {
    if (elapsedSeconds < 4) {
      return {
        title: "正在提交生成请求",
        detail: `已进入图像生成队列，本次目标 ${count} 张`,
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title: `正在生成图像${buildWaitingDots(elapsedSeconds)}`,
        detail: `模型正在组织画面内容，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }
    return {
      title: `正在生成图像${buildWaitingDots(elapsedSeconds)}`,
      detail: `复杂提示词会耗时更久，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }

  if (mode === "edit") {
    if (variant === "selection-edit") {
      if (elapsedSeconds < 6) {
        return {
          title: "正在提交选区编辑",
          detail: `遮罩与源图已上传，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
        };
      }
      return {
        title: `正在执行选区编辑${buildWaitingDots(elapsedSeconds)}`,
        detail: `系统正在根据遮罩重绘区域，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }

    if (elapsedSeconds < 6) {
      return {
        title: "正在提交编辑请求",
        detail: `源图已就绪，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }
    return {
      title: `正在编辑图像${buildWaitingDots(elapsedSeconds)}`,
      detail: `系统正在重绘并融合结果，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }

  if (elapsedSeconds < 5) {
    return {
      title: "正在提交放大任务",
      detail: `源图已上传，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }
  return {
    title: `正在放大图像${buildWaitingDots(elapsedSeconds)}`,
    detail: `系统正在增强清晰度与细节，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
  };
}

function humanizeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.failureKind === "accepted_pending") {
      return "任务已提交到上游，当前仍在处理中。建议稍后继续等待，而不是立即重新提交。";
    }
    if (error.failureKind === "result_fetch_failed") {
      return "图片结果已就绪，但下载失败。建议优先重试下载，而不是重新生成。";
    }
    if (error.failureKind === "source_invalid") {
      return "上游未识别到源图，请重新上传源图后重试。";
    }
    if (error.failureKind === "account_blocked") {
      return "当前账号不可用、已限流或授权失效，请切换账号或稍后再试。";
    }
    if (error.failureKind === "input_blocked") {
      return "请求被上游拒绝，请修改提示词、图片或参数后重试。";
    }
    if (error.failureKind === "submit_failed") {
      return "图片请求提交失败，请稍后重新提交。";
    }
  }
  const raw = error instanceof Error ? error.message : String(error ?? "处理图片失败");
  const lower = raw.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return "网络连接失败，请检查网络或服务是否正常运行";
  }
  if (lower.includes("暂无可用账号")) {
    return raw; // 已经是友好文案，直接返回
  }
  if (lower.includes("no available tokens") || lower.includes("accounts.json")) {
    return "暂无可用账号，请先在账号管理页面添加并启用账号";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("超时")) {
    return "请求超时，图像生成耗时较长，请稍后重试";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "请求过于频繁，请稍后再试";
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("token") && lower.includes("invalid")) {
    return "账号授权已失效，请在账号管理页面刷新账号状态";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "无访问权限，账号可能被限制使用";
  }
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("service unavailable")) {
    return "上游服务暂时不可用，请稍后重试";
  }
  if (lower.includes("content policy") || lower.includes("safety") || lower.includes("违规")) {
    return "提示词可能违反内容政策，请修改后重试";
  }
  return raw;
}

function extractRequestFailureMeta(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return {
      failureKind: undefined,
      retryAction: undefined,
      retryable: undefined,
      stage: undefined,
      upstreamConversationId: undefined,
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: undefined,
      fileIds: undefined,
    };
  }
  return {
    failureKind: error.failureKind,
    retryAction: error.retryAction,
    retryable: error.retryable,
    stage: error.stage,
    upstreamConversationId: error.upstreamConversationId,
    upstreamResponseId: error.upstreamResponseId,
    imageGenerationCallId: error.imageGenerationCallId,
    sourceAccountId: error.sourceAccountId,
    fileIds: error.fileIds,
  };
}

function openImageInNewTab(dataUrl: string) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain" /></body></html>`);
    w.document.close();
  }
}

export default function ImagePage() {
  const cachedWorkspaceState = getCachedImageWorkspaceState();
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const draftSelectionRef = useRef(cachedWorkspaceState.isDraftSelection);
  const autoRecoveredTurnKeysRef = useRef<Set<string>>(new Set());
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsViewportRef = useRef<HTMLDivElement>(null);

  const scrollResultsToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = resultsViewportRef.current;
    if (!viewport) {
      return;
    }
    window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });
    });
  };

  const [mode, setMode] = useState<ImageMode>("generate");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageModel, setImageModel] = useState<ImageModel>("gpt-image-2");
  const [imageSize, setImageSize] = useState<ToolbarImageSize>("auto");
  const [imageQuality, setImageQuality] = useState<ImageGenerationQuality>("medium");
  const [upscaleScale, setUpscaleScale] = useState("2x");
  const [sourceImages, setSourceImages] = useState<StoredSourceImage[]>([]);
  const [reuseLatestResultForGenerate, setReuseLatestResultForGenerate] = useState(true);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(cachedWorkspaceState.selectedConversationId);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableQuota, setAvailableQuota] = useState("加载中");
  const [recoverableTasks, setRecoverableTasks] = useState<RecoverableImageTaskItem[]>([]);
  const [activeRequest, setActiveRequest] = useState<ActiveRequestState | null>(null);
  const [submitStartedAt, setSubmitStartedAt] = useState<number | null>(null);
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [pendingPickerMode, setPendingPickerMode] = useState<ImageMode | null>(null);
  const [editorTarget, setEditorTarget] = useState<{
    conversationId: string;
    turnId: string;
    image: StoredImage;
    imageName: string;
    sourceDataUrl: string;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const selectedConversationTurns = useMemo(() => selectedConversation?.turns ?? [], [selectedConversation]);
  const latestReusableImage = useMemo(
    () => getLatestSuccessfulImage(selectedConversationTurns),
    [selectedConversationTurns],
  );
  const latestReusableSourceImage = useMemo(
    () => (latestReusableImage ? createSourceImageFromResult(latestReusableImage, "reference.png", true) : null),
    [latestReusableImage],
  );
  const latestReusableImageDataUrl = useMemo(
    () => latestReusableSourceImage?.dataUrl || "",
    [latestReusableSourceImage],
  );
  const latestTurnGeneratedMultipleImages = useMemo(() => {
    const latestTurn = selectedConversationTurns[selectedConversationTurns.length - 1] ?? null;
    if (!latestTurn || latestTurn.mode !== "generate") {
      return false;
    }
    return Number(latestTurn.count || 1) > 1;
  }, [selectedConversationTurns]);
  const parsedCount = useMemo(() => Math.max(1, Math.min(8, Number(imageCount) || 1)), [imageCount]);
  const imageSources = useMemo(() => sourceImages.filter((item) => item.role === "image"), [sourceImages]);
  const visibleSourceImages = useMemo(
    () => sourceImages.filter((item) => !item.hiddenInConversation),
    [sourceImages],
  );
  const maskSource = useMemo(() => sourceImages.find((item) => item.role === "mask") ?? null, [sourceImages]);
  const hasGenerateReferences = useMemo(() => mode === "generate" && imageSources.length > 0, [imageSources, mode]);
  const canToggleLatestResultReference = useMemo(
    () => mode === "generate" && Boolean(latestReusableImageDataUrl),
    [latestReusableImageDataUrl, mode],
  );
  const isLatestResultReferenceEnabled = useMemo(
    () => canToggleLatestResultReference && reuseLatestResultForGenerate,
    [canToggleLatestResultReference, reuseLatestResultForGenerate],
  );
  const processingStatus = useMemo(
    () =>
      activeRequest
        ? buildProcessingStatus(activeRequest.mode, submitElapsedSeconds, activeRequest.count, activeRequest.variant)
        : null,
    [activeRequest, submitElapsedSeconds],
  );
  const waitingDots = useMemo(() => buildWaitingDots(submitElapsedSeconds), [submitElapsedSeconds]);

  const focusConversation = (conversationId: string) => {
    draftSelectionRef.current = false;
    setCachedImageWorkspaceState({
      selectedConversationId: conversationId,
      isDraftSelection: false,
    });
    setSelectedConversationId(conversationId);
  };

  const openDraftConversation = () => {
    draftSelectionRef.current = true;
    setCachedImageWorkspaceState({
      selectedConversationId: null,
      isDraftSelection: true,
    });
    setSelectedConversationId(null);
  };

  const syncRuntimeTaskState = (preferredConversationId?: string | null) => {
    const tasks = listActiveImageTasks();
    const nextTask =
      tasks.find((task) => preferredConversationId && task.conversationId === preferredConversationId) ?? tasks[0] ?? null;

    setIsSubmitting(tasks.length > 0);
    setActiveRequest(
      nextTask
        ? {
          conversationId: nextTask.conversationId,
          turnId: nextTask.turnId,
          mode: nextTask.mode,
          count: nextTask.count,
          variant: nextTask.variant,
        }
        : null,
    );
    setSubmitStartedAt(nextTask?.startedAt ?? null);
    if (!nextTask) {
      setSubmitElapsedSeconds(0);
    }
  };

  const refreshHistory = async (options: { normalize?: boolean; silent?: boolean; withLoading?: boolean } = {}) => {
    const { normalize = false, silent = false, withLoading = false } = options;

    try {
      if (withLoading && mountedRef.current) {
        setIsLoadingHistory(true);
      }
      const [items, recoverableResponse] = await Promise.all([
        listImageConversations(),
        fetchRecoverableImageTasks(30).catch(() => ({ items: [] as RecoverableImageTaskItem[] })),
      ]);
      const nextItems = normalize ? await normalizeConversationHistory(items) : items;
      if (!mountedRef.current) {
        return;
      }
      setConversations(nextItems);
      setRecoverableTasks(Array.isArray(recoverableResponse.items) ? recoverableResponse.items : []);
      setSelectedConversationId((current) => {
        let nextSelectedConversationId: string | null = current;
        if (current && nextItems.some((item) => item.id === current)) {
          nextSelectedConversationId = current;
        } else if (draftSelectionRef.current) {
          nextSelectedConversationId = null;
        } else {
          const activeTaskConversationId = listActiveImageTasks()[0]?.conversationId;
          if (activeTaskConversationId && nextItems.some((item) => item.id === activeTaskConversationId)) {
            nextSelectedConversationId = activeTaskConversationId;
          } else {
            nextSelectedConversationId = nextItems[0]?.id ?? null;
          }
        }
        setCachedImageWorkspaceState({
          selectedConversationId: nextSelectedConversationId,
          isDraftSelection: draftSelectionRef.current && nextSelectedConversationId === null,
        });
        return nextSelectedConversationId;
      });
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "读取会话记录失败";
        toast.error(message);
      }
    } finally {
      if (withLoading && mountedRef.current) {
        setIsLoadingHistory(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void refreshHistory({ normalize: true, withLoading: true });
      syncRuntimeTaskState(selectedConversationId);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncRuntimeTaskState(selectedConversationId);
    });
    // 任务状态变化时只同步 runtime 状态（submitting / activeRequest），
    // 不再从磁盘全量刷新 conversations，避免覆盖 optimistic update
    const unsubscribe = subscribeImageTasks(() => {
      window.requestAnimationFrame(() => {
        syncRuntimeTaskState(selectedConversationId);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [selectedConversationId]);

  useEffect(() => {
    const loadQuota = async () => {
      try {
        const data = await fetchAccounts();
        setAvailableQuota(formatAvailableQuota(data.items));
      } catch {
        setAvailableQuota((prev) => (prev === "加载中" ? "—" : prev));
      }
    };

    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;
    void loadQuota();
  }, []);

  useEffect(() => {
    const handleCredentialsRefreshed = () => {
      void (async () => {
        try {
          const data = await fetchAccounts();
          if (!mountedRef.current) {
            return;
          }
          setAvailableQuota(formatAvailableQuota(data.items));
        } catch {
          // 启动后的静默刷新失败不打断用户操作
        }
      })();
    };

    window.addEventListener(APP_CREDENTIALS_REFRESHED_EVENT, handleCredentialsRefreshed);
    return () => {
      window.removeEventListener(APP_CREDENTIALS_REFRESHED_EVENT, handleCredentialsRefreshed);
    };
  }, []);

  useEffect(() => {
    if (!selectedConversation && !isSubmitting) {
      return;
    }
    scrollResultsToBottom(selectedConversation ? "smooth" : "auto");
  }, [selectedConversation, isSubmitting]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }
    scrollResultsToBottom(isSubmitting ? "smooth" : "auto");
  }, [selectedConversation?.id, selectedConversationTurns, isSubmitting]);

  useEffect(() => {
    if (!isSubmitting || submitStartedAt === null) {
      return;
    }

    const updateElapsed = () => {
      setSubmitElapsedSeconds(Math.max(0, Math.floor((Date.now() - submitStartedAt) / 1000)));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isSubmitting, submitStartedAt]);

  useEffect(() => {
    setCachedImageWorkspaceState({
      selectedConversationId,
      isDraftSelection: draftSelectionRef.current && selectedConversationId === null,
    });
  }, [selectedConversationId]);

  useEffect(() => {
    if (!pendingPickerMode || mode !== pendingPickerMode) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      uploadInputRef.current?.click();
      setPendingPickerMode(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [mode, pendingPickerMode]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const maxHeight = Math.min(480, Math.max(260, Math.floor(window.innerHeight * 0.42)));
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [imagePrompt, mode]);

  useEffect(() => {
    setReuseLatestResultForGenerate(!latestTurnGeneratedMultipleImages);
  }, [latestTurnGeneratedMultipleImages, selectedConversationId]);

  useEffect(() => {
    setSourceImages((prev) => {
      const hiddenItems = prev.filter((item) => item.role === "image" && item.hiddenInConversation);
      const visibleItems = prev.filter((item) => !(item.role === "image" && item.hiddenInConversation));

      if (!isLatestResultReferenceEnabled || !latestReusableSourceImage) {
        return hiddenItems.length > 0 ? visibleItems : prev;
      }

      if (
        hiddenItems.length === 1 &&
        hiddenItems[0]?.dataUrl === latestReusableSourceImage.dataUrl &&
        hiddenItems[0]?.name === "reference.png"
      ) {
        return prev;
      }

      return [
        ...visibleItems,
        {
          ...latestReusableSourceImage,
          id: makeId(),
        },
      ];
    });
  }, [isLatestResultReferenceEnabled, latestReusableSourceImage]);

  const persistConversation = async (conversation: ImageConversation) => {
    const normalizedConversation = normalizeConversation(conversation);
    await saveImageConversation(normalizedConversation);
    if (mountedRef.current) {
      setConversations((prev) => {
        const next = [normalizedConversation, ...prev.filter((item) => item.id !== normalizedConversation.id)];
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }
  };

  const updateConversation = async (
    conversationId: string,
    updater: (current: ImageConversation) => ImageConversation,
  ) => {
    const nextConversation = await updateImageConversation(conversationId, updater);
    if (mountedRef.current) {
      setConversations((prev) => {
        const next = [nextConversation, ...prev.filter((item) => item.id !== conversationId)];
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }
  };

  const resetComposer = (nextMode = mode) => {
    setMode(nextMode);
    setImagePrompt("");
    setImageCount("1");
    setImageSize("auto");
    setImageQuality("medium");
    setUpscaleScale("2x");
    setReuseLatestResultForGenerate(true);
    setSourceImages([]);
  };

  const handleModeChange = (nextMode: ImageMode) => {
    setMode(nextMode);
    setSourceImages((prev) => {
      const visibleItems = prev.filter((item) => !item.hiddenInConversation);
      if (nextMode !== "edit") {
        return visibleItems.filter((item) => item.role !== "mask");
      }

      const hasExplicitImage = visibleItems.some((item) => item.role === "image");
      if (hasExplicitImage || !latestReusableSourceImage) {
        return visibleItems;
      }

      return [
        {
          ...latestReusableSourceImage,
          id: makeId(),
          name: "inherited-source.png",
        },
      ];
    });
  };

  const openImagePickerForMode = (nextMode: ImageMode) => {
    if (isSubmitting) {
      return;
    }
    setPendingPickerMode(nextMode);
    handleModeChange(nextMode);
  };

  const applyPromptExample = (example: (typeof inspirationExamples)[number]) => {
    handleModeChange("generate");
    setImageModel(example.model);
    setImageCount(String(example.count));
    setImageSize("auto");
    setImageQuality("high");
    setImagePrompt(example.prompt);
    openDraftConversation();
    setSourceImages([]);
    textareaRef.current?.focus();
  };

  const handleCreateDraft = () => {
    openDraftConversation();
    resetComposer("generate");
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    const nextConversations = conversations.filter((item) => item.id !== id);
    setConversations(nextConversations);
    setSelectedConversationId((prev) => {
      if (prev !== id) {
        return prev;
      }
      draftSelectionRef.current = false;
      return nextConversations[0]?.id ?? null;
    });

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      const items = await listImageConversations();
      setConversations(items);
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearImageConversations();
      draftSelectionRef.current = true;
      setConversations([]);
      setSelectedConversationId(null);
      toast.success("已清空历史记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  };

  const appendFiles = async (files: File[] | FileList | null, role: "image" | "mask") => {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0) {
      return;
    }
    const nextItems = await Promise.all(
      normalizedFiles.map(async (file) => ({
        id: makeId(),
        role,
        name: file.name,
        dataUrl: await fileToDataUrl(file),
      })),
    );
    setSourceImages((prev) => {
      if (role === "mask") {
        return [...prev.filter((item) => item.role !== "mask"), nextItems[0]];
      }
      if (mode === "upscale") {
        return [
          ...prev.filter((item) => item.role === "mask"),
          {
            ...nextItems[0],
            name: nextItems[0]?.name || "upscale.png",
          },
        ];
      }
      return [...prev.filter((item) => item.role !== "mask"), ...prev.filter((item) => item.role === "mask"), ...nextItems];
    });
  };

  const handlePromptPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (isSubmitting) {
      return;
    }
    const clipboardImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (clipboardImages.length === 0) {
      return;
    }

    event.preventDefault();
    void appendFiles(clipboardImages, "image");
    toast.success(
      mode === "generate"
        ? "已从剪贴板添加参考图"
        : mode === "edit"
          ? "已从剪贴板添加源图"
          : "已从剪贴板添加放大源图",
    );
  };

  const removeSourceImage = (id: string) => {
    setSourceImages((prev) => prev.filter((item) => item.id !== id));
  };

  const handleToggleLatestResultReference = () => {
    if (!latestReusableImageDataUrl) {
      toast.error("当前会话还没有可沿用的生成结果");
      return;
    }
    setReuseLatestResultForGenerate((prev) => !prev);
    textareaRef.current?.focus();
  };

  const seedFromResult = (conversationId: string, image: StoredImage, nextMode: ImageMode) => {
    if (isSubmitting) {
      return;
    }
    const sourceImage = createSourceImageFromResult(image, "source.png");
    if (!sourceImage) {
      toast.error("当前图片没有可复用的数据");
      return;
    }
    focusConversation(conversationId);
    handleModeChange(nextMode);
    setSourceImages([sourceImage]);
    if (nextMode === "upscale") {
      setImagePrompt("");
    }
    textareaRef.current?.focus();
  };

  const openSelectionEditor = (conversationId: string, turnId: string, image: StoredImage, imageName: string) => {
    if (isSubmitting) {
      return;
    }
    const dataUrl = buildImageDataUrl(image);
    if (!dataUrl) {
      toast.error("当前图片没有可复用的数据");
      return;
    }
    setEditorTarget({
      conversationId,
      turnId,
      image,
      imageName,
      sourceDataUrl: dataUrl,
    });
  };

  const handleSelectionEditSubmit = async ({
    prompt,
    mask,
  }: {
    prompt: string;
    mask: {
      file: File;
      previewDataUrl: string;
    };
  }) => {
    if (!editorTarget) {
      return;
    }

    const conversationId = editorTarget.conversationId;
    const turnId = makeId();
    const now = new Date().toISOString();
    const selectionSourceImage = createSourceImageFromResult(editorTarget.image, editorTarget.imageName || "source.png");
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle("edit", prompt, upscaleScale),
      mode: "edit",
      prompt,
      model: imageModel,
      imageSize: "auto",
      imageQuality: "auto",
      count: 1,
      sourceImages: [
        selectionSourceImage ?? {
          id: makeId(),
          role: "image",
          name: editorTarget.imageName,
          dataUrl: editorTarget.sourceDataUrl,
        },
        {
          id: makeId(),
          role: "mask",
          name: "mask.png",
          dataUrl: mask.previewDataUrl,
        },
      ],
      images: createLoadingImages(1, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode: "edit",
      count: 1,
      variant: "selection-edit",
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    focusConversation(conversationId);
    setImagePrompt("");
    setSourceImages([]);
    setEditorTarget(null);
    startImageTask({
      conversationId,
      turnId,
      mode: "edit",
      count: 1,
      variant: "selection-edit",
      startedAt,
    });

    try {
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: [...(current.turns ?? []), draftTurn],
      }));

      const sourceImageFile = await dataUrlToFile(
        editorTarget.sourceDataUrl,
        editorTarget.imageName || "source.png",
      );
      const data = await editImage({
        prompt,
        images: [sourceImageFile],
        mask: mask.file,
        sourceReference: buildSourceReference(selectionSourceImage),
        model: imageModel,
      });
      const resultItems = mergeResultImages(turnId, data.data || [], 1);
      const failedCount = countFailures(resultItems);
      const durationMs = Date.now() - startedAt;

      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
              durationMs,
              failureKind: undefined,
              retryAction: undefined,
              retryable: undefined,
              stage: undefined,
              upstreamConversationId: undefined,
              upstreamResponseId: undefined,
              imageGenerationCallId: undefined,
              sourceAccountId: undefined,
              fileIds: undefined,
            }
            : turn,
        ),
      }));

      if (failedCount > 0) {
        toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
      } else {
        toast.success("图片已按选区编辑");
      }
    } catch (error) {
      const message = humanizeError(error);
      const failureMeta = extractRequestFailureMeta(error);
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              status: "error",
              error: message,
              failureKind: failureMeta.failureKind,
              retryAction: failureMeta.retryAction,
              retryable: failureMeta.retryable,
              stage: failureMeta.stage,
              upstreamConversationId: failureMeta.upstreamConversationId,
              upstreamResponseId: failureMeta.upstreamResponseId,
              imageGenerationCallId: failureMeta.imageGenerationCallId,
              sourceAccountId: failureMeta.sourceAccountId,
              fileIds: failureMeta.fileIds,
              images: turn.images.map((image) => ({
                ...image,
                status: "error" as const,
                error: message,
                failureKind: failureMeta.failureKind,
                retryAction: failureMeta.retryAction,
                retryable: failureMeta.retryable,
                stage: failureMeta.stage,
                upstreamConversationId: failureMeta.upstreamConversationId,
                upstreamResponseId: failureMeta.upstreamResponseId,
                imageGenerationCallId: failureMeta.imageGenerationCallId,
              })),
            }
            : turn,
        ),
      }));
      toast.error(message);
    } finally {
      finishImageTask(conversationId, turnId);
      setIsSubmitting(false);
      setActiveRequest(null);
      setSubmitStartedAt(null);
    }
  };

  const handleRetryTurn = async (conversationId: string, turn: ImageConversationTurn, imageId?: string) => {
    if (isSubmitting) {
      toast.error("正在处理中，请稍后再试");
      return;
    }

    const prompt = turn.prompt?.trim() ?? "";
    const turnMode = turn.mode || "generate";
    const turnSourceImages = Array.isArray(turn.sourceImages) ? turn.sourceImages : [];
    const turnImageSources = turnSourceImages.filter((item) => item.role === "image");
    const turnMaskSource = turnSourceImages.find((item) => item.role === "mask") ?? null;
    const turnScale = turnMode === "upscale" ? turn.scale || "2x" : undefined;
    const turnImageSize = turn.imageSize || "auto";
    const turnImageQuality = turn.imageQuality || "auto";
    const failedIndexes = turn.images
      .map((image, index) => (image.status === "error" ? index : -1))
      .filter((index) => index >= 0);
    const retryIndexes =
      imageId != null
        ? turn.images
          .map((image, index) => (image.id === imageId ? index : -1))
          .filter((index) => index >= 0)
        : failedIndexes;

    if (turnMode === "generate" && !prompt) {
      toast.error("该记录缺少提示词，无法重试");
      return;
    }
    if ((turnMode === "edit" || turnMode === "upscale") && turnImageSources.length === 0) {
      toast.error("该记录缺少源图，无法重试");
      return;
    }
    if (retryIndexes.length === 0) {
      toast.error("没有可重试的失败图片");
      return;
    }

    // ── 重试时复用原有 turn id，仅重置失败槽位为 loading 状态 ──
    const turnId = turn.id;
    const loadingImages = turn.images.map((image, index) =>
      retryIndexes.includes(index)
        ? {
          id: image.id,
          status: "loading" as const,
        }
        : image,
    );
    const retryCount = turnMode === "generate" && turnImageSources.length === 0 ? retryIndexes.length : 1;

    const startedAt = Date.now();
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode: turnMode,
      count: retryCount,
      variant: "standard",
      imageId,
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    focusConversation(conversationId);
    startImageTask({
      conversationId,
      turnId,
      mode: turnMode,
      count: retryCount,
      variant: "standard",
      startedAt,
    });

    try {
      // 把旧 turn 原地重置为 generating/loading
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId
            ? {
              ...item,
              status: "generating" as const,
              error: undefined,
              failureKind: undefined,
              retryAction: undefined,
              retryable: undefined,
              stage: undefined,
              upstreamConversationId: undefined,
              upstreamResponseId: undefined,
              imageGenerationCallId: undefined,
              sourceAccountId: undefined,
              fileIds: undefined,
              images: loadingImages,
            }
            : item,
        ),
      }));

      let resultItems: StoredImage[] = [];
      if ((turn.retryAction === "resume_polling" || turn.retryAction === "retry_download") && turn.upstreamConversationId) {
        const data = await recoverImageTask({
          conversationId: turn.upstreamConversationId,
          sourceAccountId: turn.sourceAccountId,
          revisedPrompt: prompt,
          fileIds: turn.fileIds,
          waitMs: turn.retryAction === "resume_polling" ? 60000 : 15000,
          model: turn.model,
          mode: turnMode,
        });
        resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
      } else if (turnMode === "generate") {
        if (turnImageSources.length > 0) {
          const files = await Promise.all(
            turnImageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `reference-${index + 1}.png`)),
          );
          const data = await editImage({
            prompt,
            images: files,
            sourceReference: buildSourceReference(turnImageSources[0]),
            model: turn.model,
            size: mapToolbarImageSizeToApiSize(turnImageSize as ToolbarImageSize),
            quality: turnImageQuality,
          });
          resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
        } else {
          const data = await generateImage(prompt, turn.model, retryIndexes.length, {
            size: mapToolbarImageSizeToApiSize(turnImageSize as ToolbarImageSize),
            quality: turnImageQuality,
          });
          resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
        }
      }

      if (turnMode === "edit") {
        const files = await Promise.all(
          turnImageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `image-${index + 1}.png`)),
        );
        const maskFile = turnMaskSource ? await dataUrlToFile(turnMaskSource.dataUrl, turnMaskSource.name || "mask.png") : null;
        const data = await editImage({
          prompt,
          images: files,
          mask: maskFile,
          sourceReference: buildSourceReference(turnImageSources[0]),
          model: turn.model,
        });
        resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
      }

      if (turnMode === "upscale") {
        const file = await dataUrlToFile(turnImageSources[0].dataUrl, turnImageSources[0].name || "upscale.png");
        const data = await upscaleImage({ image: file, prompt, scale: Number.parseInt(turnScale || "2", 10), model: turn.model });
        resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
      }

      const failedCount = countFailures(resultItems);
      const durationMs = Date.now() - startedAt;
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId
            ? {
              ...item,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
              durationMs,
              failureKind: undefined,
              retryAction: undefined,
              retryable: undefined,
              stage: undefined,
              upstreamConversationId: undefined,
              upstreamResponseId: undefined,
              imageGenerationCallId: undefined,
              sourceAccountId: undefined,
              fileIds: undefined,
            }
            : item,
        ),
      }));

      if (failedCount > 0) {
        toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
      } else {
        toast.success(turnMode === "generate" ? "图片已生成" : turnMode === "edit" ? "图片已编辑" : "图片已放大");
      }
    } catch (error) {
      const message = humanizeError(error);
      const failureMeta = extractRequestFailureMeta(error);
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId
            ? {
              ...item,
              status: "error",
              error: message,
              failureKind: failureMeta.failureKind,
              retryAction: failureMeta.retryAction,
              retryable: failureMeta.retryable,
              stage: failureMeta.stage,
              upstreamConversationId: failureMeta.upstreamConversationId,
              upstreamResponseId: failureMeta.upstreamResponseId,
              imageGenerationCallId: failureMeta.imageGenerationCallId,
              sourceAccountId: failureMeta.sourceAccountId,
              fileIds: failureMeta.fileIds,
              images: item.images.map((image, index) =>
                retryIndexes.includes(index)
                  ? {
                    ...image,
                    status: "error" as const,
                    error: message,
                    failureKind: failureMeta.failureKind,
                    retryAction: failureMeta.retryAction,
                    retryable: failureMeta.retryable,
                    stage: failureMeta.stage,
                    upstreamConversationId: failureMeta.upstreamConversationId,
                    upstreamResponseId: failureMeta.upstreamResponseId,
                    imageGenerationCallId: failureMeta.imageGenerationCallId,
                  }
                  : image,
              ),
            }
            : item,
        ),
      }));
      toast.error(message);
    } finally {
      finishImageTask(conversationId, turnId);
      setIsSubmitting(false);
      setActiveRequest(null);
      setSubmitStartedAt(null);
    }
  };

  useEffect(() => {
    if (isSubmitting || conversations.length === 0) {
      return;
    }
    const taskCandidate = findRecoverableTaskCandidate(recoverableTasks, conversations);
    const candidate = taskCandidate ?? findRecoverableTurn(conversations);
    if (!candidate) {
      return;
    }
    const key = taskCandidate
      ? `task:${taskCandidate.task.id}:${taskCandidate.task.updatedAt}:${taskCandidate.turn.retryAction}:${taskCandidate.turn.upstreamConversationId}:${taskCandidate.turn.upstreamResponseId}:${(taskCandidate.turn.fileIds || []).join(",")}`
      : `${candidate.conversationId}:${candidate.turn.id}:${candidate.turn.retryAction}:${candidate.turn.upstreamConversationId}:${(candidate.turn.fileIds || []).join(",")}`;
    if (autoRecoveredTurnKeysRef.current.has(key)) {
      return;
    }
    autoRecoveredTurnKeysRef.current.add(key);
    const frame = window.requestAnimationFrame(() => {
      void handleRetryTurn(candidate.conversationId, candidate.turn);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [conversations, isSubmitting, recoverableTasks]);

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (mode === "generate" && !prompt) {
      toast.error("请输入提示词");
      return;
    }
    if (mode === "edit" && imageSources.length === 0) {
      toast.error("编辑模式至少需要一张源图");
      return;
    }
    if (mode === "edit" && !prompt) {
      toast.error("编辑模式需要提示词");
      return;
    }
    if (mode === "upscale" && imageSources.length === 0) {
      toast.error("放大模式需要一张源图");
      return;
    }

    const conversationId = selectedConversationId ?? makeId();
    const turnId = makeId();
    const now = new Date().toISOString();

    const expectedCount = mode === "generate" && imageSources.length === 0 ? parsedCount : 1;
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle(mode, prompt, upscaleScale),
      mode,
      prompt,
      model: imageModel,
      imageSize: mode === "generate" ? mapToolbarImageSizeToApiSize(imageSize) : "auto",
      imageQuality: mode === "generate" ? imageQuality : "auto",
      count: expectedCount,
      scale: mode === "upscale" ? upscaleScale : undefined,
      sourceImages,
      images: createLoadingImages(expectedCount, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
    const abortController = new AbortController();
    requestAbortControllerRef.current = abortController;
    const signal = abortController.signal;
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode,
      count: expectedCount,
      variant: "standard",
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    focusConversation(conversationId);
    setImagePrompt("");
    setSourceImages([]);
    startImageTask({
      conversationId,
      turnId,
      mode,
      count: expectedCount,
      variant: "standard",
      startedAt,
    });

    try {
      // 先同步更新本地列表，让历史栏和主区域立刻出现占位消息
      if (mountedRef.current) {
        setConversations((prev) => {
          const existing = prev.find((item) => item.id === conversationId) ?? null;
          const nextConversation = normalizeConversation(
            existing
              ? {
                ...existing,
                title: draftTurn.title,
                mode: draftTurn.mode,
                prompt: draftTurn.prompt,
                model: draftTurn.model,
                imageSize: draftTurn.imageSize,
                imageQuality: draftTurn.imageQuality,
                count: draftTurn.count,
                scale: draftTurn.scale,
                sourceImages: draftTurn.sourceImages,
                images: draftTurn.images,
                createdAt: draftTurn.createdAt,
                status: draftTurn.status,
                error: draftTurn.error,
                turns: [...(existing.turns ?? []), draftTurn],
              }
              : {
                id: conversationId,
                title: draftTurn.title,
                mode: draftTurn.mode,
                prompt: draftTurn.prompt,
                model: draftTurn.model,
                imageSize: draftTurn.imageSize,
                imageQuality: draftTurn.imageQuality,
                count: draftTurn.count,
                scale: draftTurn.scale,
                sourceImages: draftTurn.sourceImages,
                images: draftTurn.images,
                createdAt: draftTurn.createdAt,
                status: draftTurn.status,
                error: draftTurn.error,
                turns: [draftTurn],
              },
          );
          const next = [nextConversation, ...prev.filter((item) => item.id !== conversationId)];
          return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
      }

      if (selectedConversationId) {
        await updateConversation(conversationId, (current) => ({
          ...current,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          imageSize: draftTurn.imageSize,
          imageQuality: draftTurn.imageQuality,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [...(current.turns ?? []), draftTurn],
        }));
      } else {
        await persistConversation({
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
          imageSize: draftTurn.imageSize,
          imageQuality: draftTurn.imageQuality,
          count: draftTurn.count,
          scale: draftTurn.scale,
          sourceImages: draftTurn.sourceImages,
          images: draftTurn.images,
          createdAt: draftTurn.createdAt,
          status: draftTurn.status,
          error: draftTurn.error,
          turns: [draftTurn],
        });
      }

      let resultItems: StoredImage[] = [];
      if (mode === "generate") {
        if (imageSources.length > 0) {
          const files = await Promise.all(
            imageSources.map((item, index) =>
              dataUrlToFile(item.dataUrl, item.name || `reference-${index + 1}.png`),
            ),
          );
          const data = await editImage({
            prompt,
            images: files,
            sourceReference: buildSourceReference(imageSources[0]),
            model: imageModel,
            size: mapToolbarImageSizeToApiSize(imageSize),
            quality: imageQuality,
            signal,
          });
          resultItems = mergeResultImages(turnId, data.data || [], 1);
        } else {
          const data = await generateImage(prompt, imageModel, parsedCount, {
            size: mapToolbarImageSizeToApiSize(imageSize),
            quality: imageQuality,
            signal,
          });
          resultItems = mergeResultImages(turnId, data.data || [], parsedCount);
        }
      }

      if (mode === "edit") {
        const files = await Promise.all(
          imageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `image-${index + 1}.png`)),
        );
        const maskFile = maskSource ? await dataUrlToFile(maskSource.dataUrl, maskSource.name || "mask.png") : null;
        const data = await editImage({
          prompt,
          images: files,
          mask: maskFile,
          sourceReference: buildSourceReference(imageSources[0]),
          model: imageModel,
          signal,
        });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      if (mode === "upscale") {
        const file = await dataUrlToFile(imageSources[0].dataUrl, imageSources[0].name || "upscale.png");
        const data = await upscaleImage({ image: file, prompt, scale: Number.parseInt(upscaleScale, 10), model: imageModel, signal });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      const failedCount = countFailures(resultItems);
      const durationMs = Date.now() - startedAt;
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
              durationMs,
              failureKind: undefined,
              retryAction: undefined,
              retryable: undefined,
              stage: undefined,
              upstreamConversationId: undefined,
              upstreamResponseId: undefined,
              imageGenerationCallId: undefined,
              sourceAccountId: undefined,
              fileIds: undefined,
            }
            : turn,
        ),
      }));

      resetComposer(mode === "generate" ? "generate" : mode);
      if (failedCount > 0) {
        toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
      } else {
        toast.success(
          mode === "generate"
            ? imageSources.length > 0
              ? "参考图生成已完成"
              : "图片已生成"
            : mode === "edit"
              ? "图片已编辑"
              : "图片已放大",
        );
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "CanceledError" || error.name === "AbortError" || error.message.includes("canceled"))) {
        // 用户主动取消，不写入错误状态，只清除 loading 状态
        await updateConversation(conversationId, (current) => ({
          ...current,
          turns: (current.turns ?? []).map((turn) =>
            turn.id === turnId
              ? {
                ...turn,
                status: "error" as const,
                error: "已取消生成",
                images: turn.images.map((image) => ({
                  ...image,
                  status: "error" as const,
                  error: "已取消生成",
                })),
              }
              : turn,
          ),
        }));
        return;
      }
      const failureMeta = extractRequestFailureMeta(error);
      const message = humanizeError(error);
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              status: "error",
              error: message,
              failureKind: failureMeta.failureKind,
              retryAction: failureMeta.retryAction,
              retryable: failureMeta.retryable,
              stage: failureMeta.stage,
              upstreamConversationId: failureMeta.upstreamConversationId,
              upstreamResponseId: failureMeta.upstreamResponseId,
              imageGenerationCallId: failureMeta.imageGenerationCallId,
              sourceAccountId: failureMeta.sourceAccountId,
              fileIds: failureMeta.fileIds,
              images: turn.images.map((image) => ({
                ...image,
                status: "error" as const,
                error: message,
                failureKind: failureMeta.failureKind,
                retryAction: failureMeta.retryAction,
                retryable: failureMeta.retryable,
                stage: failureMeta.stage,
                upstreamConversationId: failureMeta.upstreamConversationId,
                upstreamResponseId: failureMeta.upstreamResponseId,
                imageGenerationCallId: failureMeta.imageGenerationCallId,
              })),
            }
            : turn,
        ),
      }));
      toast.error(message);
    } finally {
      requestAbortControllerRef.current = null;
      finishImageTask(conversationId, turnId);
      setIsSubmitting(false);
      setActiveRequest(null);
      setSubmitStartedAt(null);
    }
  };

  const handleCancel = () => {
    requestAbortControllerRef.current?.abort();
  };

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-1",
        historyCollapsed && filesCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)]"
          : historyCollapsed && !filesCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_240px]"
          : !historyCollapsed && filesCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)]"
          : "lg:h-full lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)_240px]",
      )}
    >
      {!historyCollapsed ? (
        <HistorySidebar
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          isLoadingHistory={isLoadingHistory}
          onSelect={focusConversation}
          onDelete={(id) => {
            void handleDeleteConversation(id);
          }}
          onCreateDraft={handleCreateDraft}
          onClearHistory={() => {
            void handleClearHistory();
          }}
        />
      ) : null}

      <div className="order-1 flex flex-col overflow-visible rounded-[18px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:order-none lg:min-h-0 lg:overflow-hidden dark:border-stone-700 dark:bg-stone-900">
        <div className="shrink-0 border-b border-stone-200/80 bg-white px-4 py-2.5 sm:px-6 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryCollapsed((current) => !current)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                title={historyCollapsed ? "展开历史" : "收起历史"}
              >
                {historyCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
              <h1 className="shrink-0 text-sm font-medium text-stone-900 dark:text-stone-100">图片工作台</h1>
              <span className="text-stone-300 dark:text-stone-600">/</span>
              {selectedConversation?.title ? (
                <span className="truncate text-xs text-stone-500 dark:text-stone-400">{selectedConversation.title}</span>
              ) : (
                <span className="truncate text-xs text-stone-400 dark:text-stone-500">新会话草稿</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setFilesCollapsed((current) => !current)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              title={filesCollapsed ? "展开文件" : "收起文件"}
            >
              {filesCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
            </button>
          </div>
        </div>

        <div
          ref={resultsViewportRef}
          className="hide-scrollbar min-h-0 flex-1 overflow-visible bg-[#fcfcfb] lg:overflow-y-auto dark:bg-stone-950"
        >
          {!selectedConversation ? (
            <EmptyState examples={inspirationExamples} onApplyExample={applyPromptExample} />
          ) : (
            <div className="mx-auto flex w-full max-w-[980px] flex-col gap-8 px-4 py-8 sm:px-6">
              {selectedConversationTurns.map((turn) => (
                <ConversationTurn
                  key={turn.id}
                  turn={turn}
                  conversationId={selectedConversation.id}
                  isProcessing={Boolean(
                    isSubmitting &&
                    activeRequest &&
                    activeRequest.conversationId === selectedConversation.id &&
                    activeRequest.turnId === turn.id,
                  )}
                  processingStatus={processingStatus}
                  waitingDots={waitingDots}
                  submitElapsedSeconds={submitElapsedSeconds}
                  isSubmitting={isSubmitting}
                  retryingImageId={
                    isSubmitting &&
                    activeRequest?.conversationId === selectedConversation.id &&
                    activeRequest?.turnId === turn.id
                      ? activeRequest.imageId ?? null
                      : null
                  }
                  onOpenImageInNewTab={openImageInNewTab}
                  onOpenSelectionEditor={openSelectionEditor}
                  onSeedFromResult={seedFromResult}
                  onRetryTurn={(conversationId, currentTurn, imageId) => {
                    void handleRetryTurn(conversationId, currentTurn, imageId);
                  }}
                  onPreviewImage={(dataUrl) => setPreviewImage(dataUrl)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <ComposerPanel
            imageModel={imageModel}
            imageModelOptions={imageModelOptions as ImageModelOption[]}
            modeOptions={modeOptions as ModeOption[]}
            mode={mode}
            onModeChange={handleModeChange}
            onImageModelChange={setImageModel}
            hasGenerateReferences={hasGenerateReferences}
            imageCount={imageCount}
            onImageCountChange={setImageCount}
            imageSize={imageSize}
            imageSizeOptions={imageSizeOptions}
            onImageSizeChange={setImageSize}
            imageQuality={imageQuality}
            imageQualityOptions={imageQualityOptions}
            onImageQualityChange={setImageQuality}
            upscaleScale={upscaleScale}
            upscaleOptions={upscaleOptions}
            onUpscaleScaleChange={setUpscaleScale}
            availableQuota={availableQuota}
            sourceImages={visibleSourceImages}
            onRemoveSourceImage={removeSourceImage}
            canToggleLatestResultReference={canToggleLatestResultReference}
            useLatestResultAsReference={isLatestResultReferenceEnabled}
            onToggleLatestResultReference={handleToggleLatestResultReference}
            onOpenImageInNewTab={openImageInNewTab}
            textareaRef={textareaRef}
            imagePrompt={imagePrompt}
            onImagePromptChange={setImagePrompt}
            onPromptPaste={handlePromptPaste}
            onSubmit={() => {
              void handleSubmit();
            }}
            onCancel={handleCancel}
            isSubmitting={isSubmitting}
            uploadInputRef={uploadInputRef}
            maskInputRef={maskInputRef}
            onUploadFiles={(files, role) => {
              void appendFiles(files, role);
            }}
          />
        </div>
      </div>

      {!filesCollapsed ? (
        <FilesSidebar
          onOpenImage={(publicPath) => {
            setPreviewImage(publicPath);
          }}
        />
      ) : null}

      <ImagePreviewModal
        open={previewImage !== null}
        imageSrc={previewImage || ""}
        onClose={() => setPreviewImage(null)}
      />

      <ImageEditModal
        key={editorTarget?.turnId || "image-edit-modal"}
        open={Boolean(editorTarget)}
        imageName={editorTarget?.imageName || "image.png"}
        imageSrc={editorTarget?.sourceDataUrl || ""}
        isSubmitting={isSubmitting}
        onClose={() => {
          if (!isSubmitting) {
            setEditorTarget(null);
          }
        }}
        onSubmit={handleSelectionEditSubmit}
      />
    </section>
  );
}
