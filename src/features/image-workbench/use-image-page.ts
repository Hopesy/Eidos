"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";
import {
  fetchAccounts,
  type ImageGenerationQuality,
  type ImageModel,
  type RecoverableImageTaskItem,
} from "@/lib/api";
import { subscribeImageTasks } from "@/store/image-active-tasks";
import {
  normalizeConversation,
  primeImageConversations,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import { getCachedImageWorkspaceState, setCachedImageWorkspaceState } from "@/store/image-workspace-cache";
import { type ImageRatioOption as ToolbarImageSize } from "@/shared/image-generation";

import { downloadImageFile, openImageInNewTab } from "./browser-actions";
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
  type PromptExample,
} from "./composer";
import {
  applyComposerToolbarStateFromTurn,
  handleCancelAndEditActiveRequest as handleActiveRequestCancelAndEdit,
  getLatestConversationTurn,
  handleEditTurn as handleConversationTurnEdit,
  restoreComposerFromTurn as restoreWorkbenchComposerFromTurn,
  retractTurnAfterAbort as retractConversationTurnAfterAbort,
} from "./conversation-editing";
import { buildProcessingStatus, buildWaitingDots } from "./processing-status";
import {
  findRecoverableTaskCandidate,
  findRecoverableTaskForTurn,
  findRecoverableTurn,
  mergeRecoverableTaskIntoTurn,
} from "./recovery-candidates";
import {
  runRetryTurn,
  runSelectionEditSubmit,
  runSubmit,
  type ActiveRequestMeta,
  type EditorTarget,
  type PendingAbortAction,
} from "./submission";
import {
  type ActiveRequestState,
  createSourceImageFromResult,
  formatAvailableQuota,
  getLatestSuccessfulImage,
  makeId,
} from "./utils";
import {
  clearHistory as clearWorkbenchHistory,
  deleteConversation as deleteWorkbenchConversation,
  persistConversation as persistWorkbenchConversation,
  refreshHistory as refreshWorkbenchHistory,
  syncRuntimeTaskState as syncWorkbenchRuntimeTaskState,
  updateConversation as updateWorkbenchConversation,
} from "./workspace";

type UseImagePageOptions = {
  initialConversations?: ImageConversation[];
  initialRecoverableTasks?: RecoverableImageTaskItem[];
  initialAvailableQuota?: string;
  initialUsesImageApiService?: boolean;
};

export function useImagePage(options: UseImagePageOptions = {}) {
  const cachedWorkspaceState = getCachedImageWorkspaceState();
  const hasInitialConversations = options.initialConversations !== undefined;
  const hasInitialRecoverableTasks = options.initialRecoverableTasks !== undefined;
  const hasInitialAvailableQuota = options.initialAvailableQuota !== undefined;
  const normalizedInitialConversations = useMemo(
    () => (options.initialConversations ?? []).map(normalizeConversation),
    [options.initialConversations],
  );
  const initialSelectedConversationId = useMemo(() => {
    const cachedId = cachedWorkspaceState.selectedConversationId;
    if (cachedId && normalizedInitialConversations.some((item) => item.id === cachedId)) {
      return cachedId;
    }
    if (cachedWorkspaceState.isDraftSelection) {
      return null;
    }
    return normalizedInitialConversations[0]?.id ?? null;
  }, [cachedWorkspaceState.isDraftSelection, cachedWorkspaceState.selectedConversationId, normalizedInitialConversations]);
  const didLoadQuotaRef = useRef(false);
  const mountedRef = useRef(true);
  const draftSelectionRef = useRef(cachedWorkspaceState.isDraftSelection);
  const autoRecoveredTurnKeysRef = useRef<Set<string>>(new Set());
  const restoredToolbarConversationIdRef = useRef<string | null>(null);
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
  const [imageSize, setImageSize] = useState<ToolbarImageSize>("1:1");
  const [imageQuality, setImageQuality] = useState<ImageGenerationQuality>("medium");
  const [upscaleQuality, setUpscaleQuality] = useState<ImageGenerationQuality>("medium");
  const [sourceImages, setSourceImages] = useState<StoredSourceImage[]>([]);
  const [reuseLatestResultForGenerate, setReuseLatestResultForGenerate] = useState(true);
  const [conversations, setConversations] = useState<ImageConversation[]>(normalizedInitialConversations);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialSelectedConversationId,
  );
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(!hasInitialConversations);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableQuota, setAvailableQuota] = useState(options.initialAvailableQuota ?? "加载中");
  const [recoverableTasks, setRecoverableTasks] = useState<RecoverableImageTaskItem[]>(options.initialRecoverableTasks ?? []);
  const [activeRequest, setActiveRequest] = useState<ActiveRequestState | null>(null);
  const [submitStartedAt, setSubmitStartedAt] = useState<number | null>(null);
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [pendingPickerMode, setPendingPickerMode] = useState<ImageMode | null>(null);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [maskEditorTarget, setMaskEditorTarget] = useState<{
    sourceDataUrl: string;
    imageName: string;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const usesImageApiService = Boolean(options.initialUsesImageApiService);

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
    if (!window.matchMedia("(max-width: 1023px)").matches) {
      return;
    }
    setHistoryCollapsed(true);
    setFilesCollapsed(true);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (hasInitialConversations) {
        primeImageConversations(normalizedInitialConversations);
        setCachedImageWorkspaceState({
          selectedConversationId: initialSelectedConversationId,
          isDraftSelection: initialSelectedConversationId === null,
        });
        syncRuntimeTaskState(initialSelectedConversationId);
        return;
      }

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

    if (didLoadQuotaRef.current || hasInitialAvailableQuota) {
      return;
    }
    didLoadQuotaRef.current = true;
    void loadQuota();
  }, [hasInitialAvailableQuota]);

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
    if (!selectedConversationId) {
      restoredToolbarConversationIdRef.current = null;
      return;
    }
    if (!selectedConversation || restoredToolbarConversationIdRef.current === selectedConversationId) {
      return;
    }

    const latestTurn = getLatestConversationTurn(selectedConversation);
    if (latestTurn) {
      applyComposerToolbarStateFromTurn(
        {
          setMode,
          setImageModel,
          setImageCount,
          setImageSize,
          setImageQuality,
          setUpscaleQuality,
        },
        latestTurn,
      );
    }

    restoredToolbarConversationIdRef.current = selectedConversationId;
  }, [selectedConversation, selectedConversationId]);

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

  const resetComposer = (
    nextMode = mode,
    options?: {
      preserveImageSize?: boolean;
      preserveImageQuality?: boolean;
      preserveUpscaleQuality?: boolean;
    },
  ) => {
    resetWorkbenchComposer(composerContext, nextMode, options);
  };

  const handleModeChange = (nextMode: ImageMode) => {
    handleWorkbenchModeChange(composerContext, nextMode);
  };

  const openImagePickerForMode = (nextMode: ImageMode) => {
    openWorkbenchImagePickerForMode(composerContext, nextMode);
  };

  const applyPromptExample = (example: PromptExample) => {
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

  const handleMaskEditorSubmit = async (
    arg:
      | "open"
      | {
        file: File;
        previewDataUrl: string;
      },
  ) => {
    if (arg === "open") {
      const currentSourceImage = imageSources[0] ?? null;
      if (!currentSourceImage) {
        toast.error("请先上传源图，再添加遮罩");
        return;
      }

      setMaskEditorTarget({
        sourceDataUrl: currentSourceImage.dataUrl,
        imageName: currentSourceImage.name || "source.png",
      });
      return;
    }

    setSourceImages((prev) => [
      ...prev.filter((item) => item.role !== "mask"),
      {
        id: makeId(),
        role: "mask",
        name: arg.file.name || "mask.png",
        dataUrl: arg.previewDataUrl,
      },
    ]);
    setMaskEditorTarget(null);
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
    const recoverableTask = findRecoverableTaskForTurn(recoverableTasks, conversationId, turn);
    const retryTurn = recoverableTask ? mergeRecoverableTaskIntoTurn(turn, recoverableTask) : turn;
    await runRetryTurn({
      focusConversation,
      updateConversation,
    }, conversationId, retryTurn, imageId);
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
      usesImageApiService,
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

  return {
    uploadInputRef,
    maskInputRef,
    textareaRef,
    resultsViewportRef,
    mode,
    imagePrompt,
    setImagePrompt,
    imageCount,
    setImageCount,
    imageModel,
    setImageModel,
    imageSize,
    setImageSize,
    imageQuality,
    setImageQuality,
    upscaleQuality,
    setUpscaleQuality,
    historyCollapsed,
    setHistoryCollapsed,
    filesCollapsed,
    setFilesCollapsed,
    isLoadingHistory,
    isSubmitting,
    availableQuota,
    activeRequest,
    editorTarget,
    setEditorTarget,
    maskEditorTarget,
    setMaskEditorTarget,
    previewImage,
    setPreviewImage,
    selectedConversation,
    selectedConversationTurns,
    selectedConversationId,
    conversations,
    visibleSourceImages,
    hasGenerateReferences,
    canToggleLatestResultReference,
    isLatestResultReferenceEnabled,
    processingStatus,
    waitingDots,
    submitElapsedSeconds,
    focusConversation,
    handleCreateDraft,
    handleDeleteConversation,
    handleClearHistory,
    handleModeChange,
    openImagePickerForMode,
    applyPromptExample,
    appendFiles,
    handlePromptPaste,
    removeSourceImage,
    handleToggleLatestResultReference,
    seedFromResult,
    openSelectionEditor,
    handleSelectionEditSubmit,
    handleMaskEditorSubmit,
    handleRetryTurn,
    handleSubmit,
    handleComposerCancelAction,
    composerCancelLabel,
    composerCancelTitle,
    handleEditTurn,
    handleCopyTurnPrompt,
    openImageInNewTab,
    downloadImageFile,
  };
}
