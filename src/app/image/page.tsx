"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { toast } from "sonner";

import { ImageEditModal } from "@/components/image-edit-modal";
import { ComposerPanel, type ImageModelOption, type ModeOption } from "./_components/composer-panel";
import { ImageIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ConversationTurn } from "./_components/conversation-turn";
import { EmptyState, type InspirationExample } from "./_components/empty-state";
import { HistorySidebar } from "./_components/history-sidebar";
import {
  editImage,
  fetchAccounts,
  generateImage,
  upscaleImage,
  type InpaintSourceReference,
  type Account,
  type ImageModel,
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

const imageModelOptions: Array<{ label: string; value: ImageModel }> = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "gpt-image-1", value: "gpt-image-1" },
];

const modeOptions: Array<{ label: string; value: ImageMode; description: string }> = [
  { label: "生成", value: "generate", description: "提示词生成新图，也可上传参考图辅助生成" },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
  { label: "放大", value: "upscale", description: "提升清晰度并放大细节" },
];

const upscaleOptions = ["2x", "4x"];

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
  if (!image.b64_json) {
    return "";
  }
  return `data:image/png;base64,${image.b64_json}`;
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

function mergeResultImages(
  conversationId: string,
  items: Array<{
    b64_json?: string;
    revised_prompt?: string;
    file_id?: string;
    gen_id?: string;
    conversation_id?: string;
    parent_message_id?: string;
    source_account_id?: string;
  }>,
  expected: number,
) {
  const results: StoredImage[] = items.map((item, index) =>
    item.b64_json
      ? {
        id: `${conversationId}-${index}`,
        status: "success",
        b64_json: item.b64_json,
        revised_prompt: item.revised_prompt,
        file_id: item.file_id,
        gen_id: item.gen_id,
        conversation_id: item.conversation_id,
        parent_message_id: item.parent_message_id,
        source_account_id: item.source_account_id,
      }
      : {
        id: `${conversationId}-${index}`,
        status: "error",
        error: "接口没有返回图片数据",
      },
  );

  while (results.length < expected) {
    results.push({
      id: `${conversationId}-${results.length}`,
      status: "error",
      error: "接口返回的图片数量不足",
    });
  }
  return results;
}

function countFailures(images: StoredImage[]) {
  return images.filter((image) => image.status === "error").length;
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

function buildInpaintSourceReference(image: StoredImage): InpaintSourceReference | undefined {
  if (!image.file_id || !image.gen_id || !image.source_account_id) {
    return undefined;
  }
  return {
    original_file_id: image.file_id,
    original_gen_id: image.gen_id,
    conversation_id: image.conversation_id,
    parent_message_id: image.parent_message_id,
    source_account_id: image.source_account_id,
  };
}

function extractErrorCode(error: unknown) {
  if (typeof error !== "object" || !error) {
    return "";
  }
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string") {
    return code;
  }
  return "";
}

function shouldFallbackSelectionEdit(error: unknown) {
  const code = extractErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const normalized = `${code} ${message}`.toLowerCase();
  return (
    normalized.includes("invalid_image_reference") ||
    normalized.includes("reference") ||
    normalized.includes("source_reference") ||
    normalized.includes("所属账号")
  );
}

function openImageInNewTab(dataUrl: string) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain" /></body></html>`);
    w.document.close();
  }
}

export default function ImagePage() {
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const draftSelectionRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsViewportRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<ImageMode>("generate");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageModel, setImageModel] = useState<ImageModel>("gpt-image-2");
  const [upscaleScale, setUpscaleScale] = useState("2x");
  const [sourceImages, setSourceImages] = useState<StoredSourceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableQuota, setAvailableQuota] = useState("加载中");
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

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const selectedConversationTurns = useMemo(() => selectedConversation?.turns ?? [], [selectedConversation]);
  const parsedCount = useMemo(() => Math.max(1, Math.min(8, Number(imageCount) || 1)), [imageCount]);
  const imageSources = useMemo(() => sourceImages.filter((item) => item.role === "image"), [sourceImages]);
  const maskSource = useMemo(() => sourceImages.find((item) => item.role === "mask") ?? null, [sourceImages]);
  const hasGenerateReferences = useMemo(() => mode === "generate" && imageSources.length > 0, [imageSources, mode]);
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
    setSelectedConversationId(conversationId);
  };

  const openDraftConversation = () => {
    draftSelectionRef.current = true;
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
      const items = await listImageConversations();
      const nextItems = normalize ? await normalizeConversationHistory(items) : items;
      if (!mountedRef.current) {
        return;
      }
      setConversations(nextItems);
      setSelectedConversationId((current) => {
        if (current && nextItems.some((item) => item.id === current)) {
          return current;
        }
        if (draftSelectionRef.current) {
          return null;
        }
        const activeTaskConversationId = listActiveImageTasks()[0]?.conversationId;
        if (activeTaskConversationId && nextItems.some((item) => item.id === activeTaskConversationId)) {
          return activeTaskConversationId;
        }
        return nextItems[0]?.id ?? null;
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
    const unsubscribe = subscribeImageTasks(() => {
      void refreshHistory({ silent: true });
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
    if (!selectedConversation && !isSubmitting) {
      return;
    }
    resultsViewportRef.current?.scrollTo({
      top: resultsViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedConversation, isSubmitting]);

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
    setUpscaleScale("2x");
    setSourceImages([]);
  };

  const openImagePickerForMode = (nextMode: ImageMode) => {
    if (isSubmitting) {
      return;
    }
    setPendingPickerMode(nextMode);
    setMode(nextMode);
  };

  const applyPromptExample = (example: (typeof inspirationExamples)[number]) => {
    setMode("generate");
    setImageModel(example.model);
    setImageCount(String(example.count));
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

  const seedFromResult = (conversationId: string, image: StoredImage, nextMode: ImageMode) => {
    const dataUrl = buildImageDataUrl(image);
    if (!dataUrl) {
      toast.error("当前图片没有可复用的数据");
      return;
    }
    focusConversation(conversationId);
    setMode(nextMode);
    setSourceImages([
      {
        id: makeId(),
        role: "image",
        name: "source.png",
        dataUrl,
      },
    ]);
    if (nextMode === "upscale") {
      setImagePrompt("");
    }
    textareaRef.current?.focus();
  };

  const openSelectionEditor = (conversationId: string, turnId: string, image: StoredImage, imageName: string) => {
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

    const sourceReference = buildInpaintSourceReference(editorTarget.image);
    const conversationId = editorTarget.conversationId;
    const turnId = makeId();
    const now = new Date().toISOString();
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle("edit", prompt, upscaleScale),
      mode: "edit",
      prompt,
      model: imageModel,
      count: 1,
      sourceImages: [
        {
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

      let fallbackImageFile = sourceReference
        ? null
        : await dataUrlToFile(editorTarget.sourceDataUrl, editorTarget.imageName || "source.png");
      let data;
      try {
        data = await editImage({
          prompt,
          images: fallbackImageFile ? [fallbackImageFile] : [],
          mask: mask.file,
          sourceReference,
          model: imageModel,
        });
      } catch (error) {
        if (!sourceReference || !shouldFallbackSelectionEdit(error)) {
          throw error;
        }
        fallbackImageFile =
          fallbackImageFile ??
          (await dataUrlToFile(editorTarget.sourceDataUrl, editorTarget.imageName || "source.png"));
        data = await editImage({
          prompt,
          images: [fallbackImageFile],
          mask: mask.file,
          model: imageModel,
        });
      }
      const resultItems = mergeResultImages(turnId, data.data || [], 1);
      const failedCount = countFailures(resultItems);

      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
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
      const message = error instanceof Error ? error.message : "处理图片失败";
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              status: "error",
              error: message,
              images: turn.images.map((image) => ({
                ...image,
                status: "error" as const,
                error: message,
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

  const handleRetryTurn = async (conversationId: string, turn: ImageConversationTurn) => {
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
    const expectedCount = Math.max(1, turn.count || 1);

    if (turnMode === "generate" && !prompt) {
      toast.error("该记录缺少提示词，无法重试");
      return;
    }
    if ((turnMode === "edit" || turnMode === "upscale") && turnImageSources.length === 0) {
      toast.error("该记录缺少源图，无法重试");
      return;
    }

    const turnId = makeId();
    const now = new Date().toISOString();
    const draftTurn = createConversationTurn({
      turnId,
      title: buildConversationTitle(turnMode, prompt, turnScale || upscaleScale),
      mode: turnMode,
      prompt,
      model: turn.model,
      count: expectedCount,
      scale: turnScale,
      sourceImages: turnSourceImages,
      images: createLoadingImages(expectedCount, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
    setIsSubmitting(true);
    setActiveRequest({
      conversationId,
      turnId,
      mode: turnMode,
      count: expectedCount,
      variant: "standard",
    });
    setSubmitElapsedSeconds(0);
    setSubmitStartedAt(startedAt);
    focusConversation(conversationId);
    startImageTask({
      conversationId,
      turnId,
      mode: turnMode,
      count: expectedCount,
      variant: "standard",
      startedAt,
    });

    try {
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: [...(current.turns ?? []), draftTurn],
      }));

      let resultItems: StoredImage[] = [];
      if (turnMode === "generate") {
        if (turnImageSources.length > 0) {
          const files = await Promise.all(
            turnImageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `reference-${index + 1}.png`)),
          );
          const data = await editImage({ prompt, images: files, model: turn.model });
          resultItems = mergeResultImages(turnId, data.data || [], 1);
        } else {
          const data = await generateImage(prompt, turn.model, expectedCount);
          resultItems = mergeResultImages(turnId, data.data || [], expectedCount);
        }
      }

      if (turnMode === "edit") {
        const files = await Promise.all(
          turnImageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `image-${index + 1}.png`)),
        );
        const maskFile = turnMaskSource ? await dataUrlToFile(turnMaskSource.dataUrl, turnMaskSource.name || "mask.png") : null;
        const data = await editImage({ prompt, images: files, mask: maskFile, model: turn.model });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      if (turnMode === "upscale") {
        const file = await dataUrlToFile(turnImageSources[0].dataUrl, turnImageSources[0].name || "upscale.png");
        const data = await upscaleImage({ image: file, prompt, scale: Number.parseInt(turnScale || "2", 10), model: turn.model });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      const failedCount = countFailures(resultItems);
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId
            ? {
              ...item,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
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
      const message = error instanceof Error ? error.message : "处理图片失败";
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId
            ? {
              ...item,
              status: "error",
              error: message,
              images: item.images.map((image) => ({
                ...image,
                status: "error" as const,
                error: message,
              })),
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
      count: expectedCount,
      scale: mode === "upscale" ? upscaleScale : undefined,
      sourceImages,
      images: createLoadingImages(expectedCount, turnId),
      createdAt: now,
      status: "generating",
    });

    const startedAt = Date.now();
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
      if (selectedConversationId) {
        await updateConversation(conversationId, (current) => ({
          ...current,
          turns: [...(current.turns ?? []), draftTurn],
        }));
      } else {
        await persistConversation({
          id: conversationId,
          title: draftTurn.title,
          mode: draftTurn.mode,
          prompt: draftTurn.prompt,
          model: draftTurn.model,
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
            imageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `reference-${index + 1}.png`)),
          );
          const data = await editImage({ prompt, images: files, model: imageModel });
          resultItems = mergeResultImages(turnId, data.data || [], 1);
        } else {
          const data = await generateImage(prompt, imageModel, parsedCount);
          resultItems = mergeResultImages(turnId, data.data || [], parsedCount);
        }
      }

      if (mode === "edit") {
        const files = await Promise.all(
          imageSources.map((item, index) => dataUrlToFile(item.dataUrl, item.name || `image-${index + 1}.png`)),
        );
        const maskFile = maskSource ? await dataUrlToFile(maskSource.dataUrl, maskSource.name || "mask.png") : null;
        const data = await editImage({ prompt, images: files, mask: maskFile, model: imageModel });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      if (mode === "upscale") {
        const file = await dataUrlToFile(imageSources[0].dataUrl, imageSources[0].name || "upscale.png");
        const data = await upscaleImage({ image: file, prompt, scale: Number.parseInt(upscaleScale, 10), model: imageModel });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      }

      const failedCount = countFailures(resultItems);
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              images: resultItems,
              status: failedCount > 0 ? "error" : "success",
              error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
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
      const message = error instanceof Error ? error.message : "处理图片失败";
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId
            ? {
              ...turn,
              status: "error",
              error: message,
              images: turn.images.map((image) => ({
                ...image,
                status: "error" as const,
                error: message,
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

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-1.5",
        historyCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)]"
          : "lg:h-full lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)]",
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

      <div className="order-1 flex flex-col overflow-visible rounded-[18px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:order-none lg:min-h-0 lg:overflow-hidden">
        <div className="shrink-0 border-b border-stone-200/80 px-5 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-stone-950 text-white shadow-sm">
                <ImageIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[15px] font-semibold tracking-tight text-stone-950">图片工作台</h1>
                  <span className="hidden truncate text-[13px] text-stone-400 sm:inline">从一个提示词，开始完整的图像工作流</span>
                  {selectedConversation?.title ? (
                    <span className="truncate rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                      {selectedConversation.title}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full bg-stone-950/[0.06] px-3 py-1.5 text-xs font-medium text-stone-700 xl:inline-flex">
                <span className="size-1.5 rounded-full bg-stone-400" />
                {imageModel}
              </span>
              <button
                type="button"
                onClick={() => setHistoryCollapsed((current) => !current)}
                className="inline-flex size-8 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 transition hover:bg-stone-50 hover:text-stone-800"
                title={historyCollapsed ? "展开历史" : "收起历史"}
              >
                {historyCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
            </div>
          </div>
        </div>

        <div
          ref={resultsViewportRef}
          className="hide-scrollbar min-h-0 flex-1 overflow-visible bg-[#fcfcfb] lg:overflow-y-auto"
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
                  onOpenImageInNewTab={openImageInNewTab}
                  onOpenSelectionEditor={openSelectionEditor}
                  onSeedFromResult={seedFromResult}
                  onRetryTurn={(conversationId, currentTurn) => {
                    void handleRetryTurn(conversationId, currentTurn);
                  }}
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
            onModeChange={setMode}
            onImageModelChange={setImageModel}
            hasGenerateReferences={hasGenerateReferences}
            imageCount={imageCount}
            onImageCountChange={setImageCount}
            upscaleScale={upscaleScale}
            upscaleOptions={upscaleOptions}
            onUpscaleScaleChange={setUpscaleScale}
            availableQuota={availableQuota}
            sourceImages={sourceImages}
            onRemoveSourceImage={removeSourceImage}
            onOpenImageInNewTab={openImageInNewTab}
            textareaRef={textareaRef}
            imagePrompt={imagePrompt}
            onImagePromptChange={setImagePrompt}
            onPromptPaste={handlePromptPaste}
            onSubmit={() => {
              void handleSubmit();
            }}
            isSubmitting={isSubmitting}
            uploadInputRef={uploadInputRef}
            maskInputRef={maskInputRef}
            onUploadFiles={(files, role) => {
              void appendFiles(files, role);
            }}
          />
        </div>
      </div>

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
