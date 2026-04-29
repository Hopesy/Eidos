"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ImageEditModal } from "@/components/image-edit-modal";
import { ImagePreviewModal } from "@/components/image-preview-modal";
import {
  ComposerPanel,
  type GenerationOption,
  type ImageModelOption,
  type ModeOption,
} from "./_components/composer-panel";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ConversationTurn } from "./_components/conversation-turn";
import { EmptyState, type InspirationExample } from "./_components/empty-state";
import { HistorySidebar } from "./_components/history-sidebar";
import { FilesSidebar } from "./_components/files-sidebar";
import {
  applyPromptExample as applyWorkbenchPromptExample,
  appendFiles as appendWorkbenchFiles,
  handleCreateDraft as handleWorkbenchCreateDraft,
  handleModeChange as handleWorkbenchModeChange,
  handlePromptPaste as handleWorkbenchPromptPaste,
  handleToggleLatestResultReference as toggleWorkbenchLatestResultReference,
  openImagePickerForMode as openWorkbenchImagePickerForMode,
  openSelectionEditor as openWorkbenchSelectionEditor,
  removeSourceImage as removeWorkbenchSourceImage,
  resetComposer as resetWorkbenchComposer,
  seedFromResult as seedWorkbenchFromResult,
} from "@/features/image-workbench/composer";
import {
  handleCancelAndEditActiveRequest as handleActiveRequestCancelAndEdit,
  handleEditTurn as handleConversationTurnEdit,
  restoreComposerFromTurn as restoreWorkbenchComposerFromTurn,
  retractTurnAfterAbort as retractConversationTurnAfterAbort,
} from "@/features/image-workbench/conversation-editing";
import {
  clearHistory as clearWorkbenchHistory,
  deleteConversation as deleteWorkbenchConversation,
  persistConversation as persistWorkbenchConversation,
  refreshHistory as refreshWorkbenchHistory,
  syncRuntimeTaskState as syncWorkbenchRuntimeTaskState,
  updateConversation as updateWorkbenchConversation,
} from "@/features/image-workbench/workspace";
import {
  type ActiveRequestState,
  createSourceImageFromResult,
  formatAvailableQuota,
  getLatestSuccessfulImage,
  makeId,
} from "@/features/image-workbench/utils";
import { downloadImageFile, openImageInNewTab } from "@/features/image-workbench/browser-actions";
import { buildProcessingStatus, buildWaitingDots } from "@/features/image-workbench/processing-status";
import { findRecoverableTaskCandidate, findRecoverableTurn } from "@/features/image-workbench/recovery-candidates";
import {
  runRetryTurn,
  runSelectionEditSubmit,
  runSubmit,
  type ActiveRequestMeta,
  type EditorTarget,
  type PendingAbortAction,
} from "@/features/image-workbench/submission";
import {
  fetchAccounts,
  type ImageGenerationQuality,
  type ImageModel,
  type RecoverableImageTaskItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import {
  subscribeImageTasks,
} from "@/store/image-active-tasks";
import { getCachedImageWorkspaceState, setCachedImageWorkspaceState } from "@/store/image-workspace-cache";
import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";
import {
  type ImageRatioOption as ToolbarImageSize,
} from "@/shared/image-generation";

const imageModelOptions: Array<{ label: string; value: ImageModel }> = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "gpt-image-1", value: "gpt-image-1" },
];

const modeOptions: Array<{ label: string; value: ImageMode; description: string }> = [
  { label: "生成", value: "generate", description: "提示词生成新图，也可上传参考图辅助生成" },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
  { label: "增强", value: "upscale", description: "基于源图做高清增强，提升清晰度与细节" },
];

const imageSizeOptions: GenerationOption<ToolbarImageSize>[] = [
  { label: "Auto", value: "auto" },
  { label: "1:1 方图", value: "1:1" },
  { label: "3:2 横图", value: "3:2" },
  { label: "2:3 竖图", value: "2:3" },
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
];

const imageQualityOptions: GenerationOption<ImageGenerationQuality>[] = [
  { label: "Auto", value: "auto" },
  { label: "1K", value: "low" },
  { label: "2K", value: "medium" },
  { label: "4K", value: "high" },
];

const upscaleQualityOptions: GenerationOption<ImageGenerationQuality>[] = [
  { label: "Auto", value: "auto" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];


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


export default function ImagePage() {
  const cachedWorkspaceState = getCachedImageWorkspaceState();
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const draftSelectionRef = useRef(cachedWorkspaceState.isDraftSelection);
  const autoRecoveredTurnKeysRef = useRef<Set<string>>(new Set());
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const pendingAbortActionRef = useRef<PendingAbortAction | null>(null);
  const activeRequestMetaRef = useRef<ActiveRequestMeta | null>(null);
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
  const [upscaleQuality, setUpscaleQuality] = useState<ImageGenerationQuality>("medium");
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
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
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

  const runtimeTaskContext = {
    setIsSubmitting,
    setActiveRequest,
    setSubmitStartedAt,
    setSubmitElapsedSeconds,
  };

  const syncRuntimeTaskState = (preferredConversationId?: string | null) => {
    syncWorkbenchRuntimeTaskState(runtimeTaskContext, preferredConversationId);
  };

  const historyContext = {
    mountedRef,
    draftSelectionRef,
    setConversations,
    setRecoverableTasks,
    setSelectedConversationId,
    setIsLoadingHistory,
    setCachedWorkspaceState: setCachedImageWorkspaceState,
  };

  const refreshHistory = async (options: { normalize?: boolean; silent?: boolean; withLoading?: boolean } = {}) => {
    await refreshWorkbenchHistory(historyContext, options);
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
    await persistWorkbenchConversation({ mountedRef, setConversations }, conversation);
  };

  const updateConversation = async (
    conversationId: string,
    updater: (current: ImageConversation) => ImageConversation,
  ) => {
    await updateWorkbenchConversation({ mountedRef, setConversations }, conversationId, updater);
  };

  const composerContext = {
    mode,
    isSubmitting,
    latestReusableSourceImage,
    latestReusableImageDataUrl,
    textareaRef,
    setPendingPickerMode,
    setMode,
    setImagePrompt,
    setImageCount,
    setImageModel,
    setImageSize,
    setImageQuality,
    setUpscaleQuality,
    setReuseLatestResultForGenerate,
    setSourceImages,
    setEditorTarget,
    focusConversation,
    openDraftConversation,
  };

  const resetComposer = (nextMode = mode) => {
    resetWorkbenchComposer(composerContext, nextMode);
  };

  const handleModeChange = (nextMode: ImageMode) => {
    handleWorkbenchModeChange(composerContext, nextMode);
  };

  const openImagePickerForMode = (nextMode: ImageMode) => {
    openWorkbenchImagePickerForMode(composerContext, nextMode);
  };

  const applyPromptExample = (example: InspirationExample) => {
    applyWorkbenchPromptExample(composerContext, example);
  };

  const handleCreateDraft = () => {
    handleWorkbenchCreateDraft(composerContext);
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteWorkbenchConversation({ draftSelectionRef, setConversations, setSelectedConversationId }, conversations, id);
  };

  const handleClearHistory = async () => {
    await clearWorkbenchHistory({ draftSelectionRef, setConversations, setSelectedConversationId });
  };

  const appendFiles = async (files: File[] | FileList | null, role: "image" | "mask") => {
    await appendWorkbenchFiles(composerContext, files, role);
  };

  const handlePromptPaste = (event: Parameters<typeof handleWorkbenchPromptPaste>[1]) => {
    handleWorkbenchPromptPaste(composerContext, event);
  };

  const removeSourceImage = (id: string) => {
    removeWorkbenchSourceImage(setSourceImages, id);
  };

  const handleToggleLatestResultReference = () => {
    toggleWorkbenchLatestResultReference(composerContext);
  };

  const seedFromResult = (conversationId: string, image: StoredImage, nextMode: ImageMode) => {
    seedWorkbenchFromResult(composerContext, conversationId, image, nextMode);
  };

  const openSelectionEditor = (conversationId: string, turnId: string, image: StoredImage, imageName: string) => {
    openWorkbenchSelectionEditor(composerContext, conversationId, turnId, image, imageName);
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
    await runSelectionEditSubmit({
      mountedRef,
      requestAbortControllerRef,
      pendingAbortActionRef,
      activeRequestMetaRef,
      setIsSubmitting,
      setActiveRequest,
      setSubmitElapsedSeconds,
      setSubmitStartedAt,
      setConversations,
      setImagePrompt,
      setSourceImages,
      setEditorTarget,
      focusConversation,
      updateConversation,
      persistConversation,
      resetComposer,
      retractTurnAfterAbort,
      restoreComposerFromTurn,
      editorTarget,
      imageModel,
    }, {
      prompt,
      mask,
    });
  };

  const handleRetryTurn = async (conversationId: string, turn: ImageConversationTurn, imageId?: string) => {
    await runRetryTurn({
      mountedRef,
      requestAbortControllerRef,
      pendingAbortActionRef,
      activeRequestMetaRef,
      setIsSubmitting,
      setActiveRequest,
      setSubmitElapsedSeconds,
      setSubmitStartedAt,
      setConversations,
      setImagePrompt,
      setSourceImages,
      setEditorTarget,
      focusConversation,
      updateConversation,
      persistConversation,
      resetComposer,
      retractTurnAfterAbort,
      restoreComposerFromTurn,
      isSubmitting,
    }, conversationId, turn, imageId);
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
    await runSubmit({
      mountedRef,
      requestAbortControllerRef,
      pendingAbortActionRef,
      activeRequestMetaRef,
      setIsSubmitting,
      setActiveRequest,
      setSubmitElapsedSeconds,
      setSubmitStartedAt,
      setConversations,
      setImagePrompt,
      setSourceImages,
      setEditorTarget,
      focusConversation,
      updateConversation,
      persistConversation,
      resetComposer,
      retractTurnAfterAbort,
      restoreComposerFromTurn,
      selectedConversationId,
      mode,
      imagePrompt,
      imageSources,
      maskSource,
      parsedCount,
      imageModel,
      imageSize,
      imageQuality,
      upscaleQuality,
      sourceImages,
    });
  };


  const handleCancel = () => {
    requestAbortControllerRef.current?.abort();
  };

  const conversationEditingContext = {
    mountedRef,
    draftSelectionRef,
    requestAbortControllerRef,
    pendingAbortActionRef,
    activeRequestMetaRef,
    textareaRef,
    isSubmitting,
    activeRequest,
    setConversations,
    setSelectedConversationId,
    setMode,
    setImageModel,
    setImageCount,
    setImageSize,
    setImageQuality,
    setUpscaleQuality,
    setReuseLatestResultForGenerate,
    setSourceImages,
    setImagePrompt,
    setEditorTarget,
    setCachedWorkspaceState: setCachedImageWorkspaceState,
    focusConversation,
    openDraftConversation,
    updateConversation,
  };

  const retractTurnAfterAbort = async (conversationId: string, turnId: string) => {
    return retractConversationTurnAfterAbort(conversationEditingContext, conversationId, turnId);
  };

  const handleCopyTurnPrompt = async (prompt: string) => {
    if (!prompt.trim()) {
      toast.error("当前记录没有可复制的提示词");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败，请检查剪贴板权限");
    }
  };

  const restoreComposerFromTurn = (conversationId: string | null, turn: ImageConversationTurn, successMessage?: string) => {
    restoreWorkbenchComposerFromTurn(conversationEditingContext, conversationId, turn, successMessage);
  };

  const handleEditTurn = async (conversationId: string, turn: ImageConversationTurn) => {
    await handleConversationTurnEdit(conversationEditingContext, conversationId, turn);
  };

  const handleCancelAndEditActiveRequest = () => {
    handleActiveRequestCancelAndEdit(conversationEditingContext, conversations);
  };

  const composerCancelMode = activeRequestMetaRef.current?.retractOnEdit ? "cancel-and-edit" : "cancel";
  const composerCancelLabel = "取消";
  const composerCancelTitle = "取消当前任务";
  const handleComposerCancelAction = () => {
    if (composerCancelMode === "cancel-and-edit") {
      handleCancelAndEditActiveRequest();
      return;
    }
    handleCancel();
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
                  onEditTurn={handleEditTurn}
                  onCopyPrompt={(prompt) => {
                    void handleCopyTurnPrompt(prompt);
                  }}
                  onDownloadImage={downloadImageFile}
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
            upscaleQuality={upscaleQuality}
            upscaleQualityOptions={upscaleQualityOptions}
            onUpscaleQualityChange={setUpscaleQuality}
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
            onCancel={handleComposerCancelAction}
            cancelButtonLabel={composerCancelLabel}
            cancelButtonTitle={composerCancelTitle}
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
