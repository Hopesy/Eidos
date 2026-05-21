"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";
import {
  addImageFavorite as createImageFavorite,
  deleteImageFavorite as removeImageFavorite,
  fetchAccounts,
  fetchImageFavorite,
  fetchImageFavorites,
  type GalleryImageItem,
  type ImageGenerationQuality,
  type ImageOutputFormat,
  type ImageModel,
  type RecoverableImageTaskItem,
} from "@/lib/api";
import { normalizeImageOutputFormat, resolveImageRatioFromSize, type ImageRatioOption as ToolbarImageSize } from "@/shared/image-generation";
import { subscribeImageTasks } from "@/store/image-active-tasks";
import {
  primeImageConversations,
  type ImageConversation,
  type ImageConversationTurn,
  type ImageMode,
  type StoredImage,
  type StoredSourceImage,
} from "@/store/image-conversations";
import { getCachedImageWorkspaceState, setCachedImageWorkspaceState } from "@/store/image-workspace-cache";

import { downloadImageFile } from "./browser-actions";
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
import { buildProcessingStatus } from "./processing-status";
import {
  findRecoverableTaskForTurn,
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
  normalizeConversationHistory,
  normalizeConversationRuntimeState,
} from "./utils";
import {
  clearHistory as clearWorkbenchHistory,
  deleteConversation as deleteWorkbenchConversation,
  persistConversation as persistWorkbenchConversation,
  refreshHistory as refreshWorkbenchHistory,
  syncRuntimeTaskState as syncWorkbenchRuntimeTaskState,
  updateConversation as updateWorkbenchConversation,
} from "./workspace";
import { applyTurnCanceled } from "./turn-patches";

type UseImagePageOptions = {
  initialConversations?: ImageConversation[];
  initialRecoverableTasks?: RecoverableImageTaskItem[];
  initialAvailableQuota?: string;
  initialUsesImageApiService?: boolean;
  initialImageFormat?: ImageOutputFormat;
};

const DRAFT_REUSE_LATEST_PREFERENCE_KEY = "__draft__";

function getReuseLatestPreferenceKey(conversationId: string | null) {
  return conversationId || DRAFT_REUSE_LATEST_PREFERENCE_KEY;
}

function buildFavoriteImageKey(conversationId: string, turnId: string, imageLocalId: string) {
  return `${conversationId}:${turnId}:${imageLocalId}`;
}

export function useImagePage(options: UseImagePageOptions = {}) {
  const cachedWorkspaceState = getCachedImageWorkspaceState();
  const hasInitialConversations = options.initialConversations !== undefined;
  const hasInitialRecoverableTasks = options.initialRecoverableTasks !== undefined;
  const hasInitialAvailableQuota = options.initialAvailableQuota !== undefined;
  const initialConversationState = useMemo(
    () => normalizeConversationRuntimeState(options.initialConversations ?? []),
    [options.initialConversations],
  );
  const normalizedInitialConversations = initialConversationState.items;
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
  const restoredToolbarConversationIdRef = useRef<string | null>(null);
  const reuseLatestPreferenceScopeRef = useRef<string | null>(initialSelectedConversationId);
  const reuseLatestPreferenceRef = useRef<Map<string, boolean>>(new Map());
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const pendingAbortActionRef = useRef<PendingAbortAction | null>(null);
  const activeRequestMetaRef = useRef<ActiveRequestMeta | null>(null);
  const retryAbortControllersRef = useRef(new Map<string, {
    controller: AbortController;
    conversationId: string;
    turnId: string;
    imageIds: string[];
  }>());
  const uploadInputRef = useRef<HTMLInputElement>(null);
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
  const [imageQuality, setImageQuality] = useState<ImageGenerationQuality>("high");
  const [imageFormat, setImageFormat] = useState<ImageOutputFormat>(
    normalizeImageOutputFormat(options.initialImageFormat),
  );
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
  const [favoriteItems, setFavoriteItems] = useState<GalleryImageItem[]>([]);
  const usesImageApiService = Boolean(options.initialUsesImageApiService);

  const favoriteByImageKey = useMemo(() => {
    const map = new Map<string, GalleryImageItem>();
    for (const item of favoriteItems) {
      map.set(buildFavoriteImageKey(item.conversationId, item.turnId, item.imageLocalId), item);
    }
    return map;
  }, [favoriteItems]);

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
  const defaultReuseLatestResultForGenerate = !latestTurnGeneratedMultipleImages;
  const processingStatus = useMemo(
    () =>
      activeRequest
        ? buildProcessingStatus(activeRequest.mode, submitElapsedSeconds, activeRequest.count, activeRequest.variant)
        : null,
    [activeRequest, submitElapsedSeconds],
  );

  const focusConversation = (conversationId: string) => {
    reuseLatestPreferenceRef.current.set(
      getReuseLatestPreferenceKey(selectedConversationId),
      reuseLatestResultForGenerate,
    );
    if (
      selectedConversationId === null &&
      !conversations.some((item) => item.id === conversationId) &&
      !reuseLatestPreferenceRef.current.has(getReuseLatestPreferenceKey(conversationId))
    ) {
      reuseLatestPreferenceRef.current.set(getReuseLatestPreferenceKey(conversationId), reuseLatestResultForGenerate);
    }
    draftSelectionRef.current = false;
    setCachedImageWorkspaceState({
      selectedConversationId: conversationId,
      isDraftSelection: false,
    });
    setSelectedConversationId(conversationId);
  };

  const openDraftConversation = () => {
    reuseLatestPreferenceRef.current.set(
      getReuseLatestPreferenceKey(selectedConversationId),
      reuseLatestResultForGenerate,
    );
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
    let disposed = false;

    void (async () => {
      try {
        const response = await fetchImageFavorites();
        if (!disposed && mountedRef.current) {
          setFavoriteItems(Array.isArray(response.items) ? response.items : []);
        }
      } catch {
        if (!disposed && mountedRef.current) {
          setFavoriteItems([]);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (hasInitialConversations) {
        primeImageConversations(normalizedInitialConversations);
        setCachedImageWorkspaceState({
          selectedConversationId: initialSelectedConversationId,
          isDraftSelection: initialSelectedConversationId === null,
        });
        if (initialConversationState.changed) {
          void normalizeConversationHistory(options.initialConversations ?? [])
            .then((items) => {
              if (!mountedRef.current) {
                return;
              }
              primeImageConversations(items);
              setConversations(items);
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : "清理中断任务失败";
              toast.error(message);
            });
        }
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
          setImageFormat,
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
    const previousScope = reuseLatestPreferenceScopeRef.current;
    if (previousScope === selectedConversationId) {
      return;
    }

    reuseLatestPreferenceRef.current.set(
      getReuseLatestPreferenceKey(previousScope),
      reuseLatestResultForGenerate,
    );
    reuseLatestPreferenceScopeRef.current = selectedConversationId;

    const nextKey = getReuseLatestPreferenceKey(selectedConversationId);
    setReuseLatestResultForGenerate(
      reuseLatestPreferenceRef.current.has(nextKey)
        ? Boolean(reuseLatestPreferenceRef.current.get(nextKey))
        : defaultReuseLatestResultForGenerate,
    );
  }, [defaultReuseLatestResultForGenerate, reuseLatestResultForGenerate, selectedConversationId]);

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
    setImageFormat,
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
      preserveImageFormat?: boolean;
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
    setFavoriteItems((prev) => prev.filter((item) => item.conversationId !== id));
  };

  const handleClearHistory = async () => {
    await clearWorkbenchHistory({ draftSelectionRef, setConversations, setSelectedConversationId });
    setFavoriteItems([]);
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

  const isImageFavorited = (conversationId: string, turnId: string, image: StoredImage) => {
    return favoriteByImageKey.has(buildFavoriteImageKey(conversationId, turnId, image.id));
  };

  const handleToggleFavorite = async (conversationId: string, turn: ImageConversationTurn, image: StoredImage) => {
    if (image.status !== "success" || (!image.image_id && !image.url && !image.b64_json)) {
      toast.error("当前图片还没有可收藏的数据");
      return;
    }

    const key = buildFavoriteImageKey(conversationId, turn.id, image.id);
    const existing = favoriteByImageKey.get(key);
    if (existing) {
      setFavoriteItems((prev) => prev.filter((item) => item.favoriteId !== existing.favoriteId));
      try {
        await removeImageFavorite(existing.favoriteId);
        toast.success("已取消收藏");
      } catch (error) {
        setFavoriteItems((prev) => [existing, ...prev.filter((item) => item.favoriteId !== existing.favoriteId)]);
        toast.error(error instanceof Error ? error.message : "取消收藏失败");
      }
      return;
    }

    try {
      const response = await createImageFavorite({
        conversationId,
        turnId: turn.id,
        imageLocalId: image.id,
        imageId: image.image_id,
      });
      setFavoriteItems((prev) => [
        response.item,
        ...prev.filter(
          (item) =>
            buildFavoriteImageKey(item.conversationId, item.turnId, item.imageLocalId) !== key,
        ),
      ]);
      toast.success("已收藏到画廊");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏失败");
    }
  };

  const seedFavoriteItem = (item: GalleryImageItem) => {
    if (isSubmitting) {
      toast.error("当前任务处理中，暂时不能切换会话");
      return;
    }

    openDraftConversation();
    setMode("generate");
    setImagePrompt(item.prompt || "");
    setImageCount(String(Math.max(1, Number(item.count) || 1)));
    setImageModel(item.model);
    setImageSize(item.imageRatio ?? resolveImageRatioFromSize(item.imageSize));
    setImageQuality(item.imageQuality ?? "medium");
    setUpscaleQuality("medium");
    setReuseLatestResultForGenerate(false);
    setSourceImages([]);
    setEditorTarget(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = item.prompt?.length ?? 0;
      if (textareaRef.current) {
        textareaRef.current.selectionStart = length;
        textareaRef.current.selectionEnd = length;
      }
    });

    toast.success("已用收藏配置打开新会话");
  };

  const seedFavoriteConfiguration = async (favoriteId: string) => {
    const cached = favoriteItems.find((item) => item.favoriteId === favoriteId);
    if (cached) {
      seedFavoriteItem(cached);
      return;
    }

    try {
      const response = await fetchImageFavorite(favoriteId);
      seedFavoriteItem(response.item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取收藏配置失败");
    }
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
      imageSize,
      imageQuality,
      imageFormat,
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
      retryAbortControllersRef,
      retractTurnAfterAbort,
    }, conversationId, retryTurn, imageId);
  };

  const handleCancelRetry = async (conversationId: string, turnId: string, imageId?: string) => {
    for (const entry of retryAbortControllersRef.current.values()) {
      if (entry.conversationId !== conversationId || entry.turnId !== turnId) {
        continue;
      }
      if (imageId && !entry.imageIds.includes(imageId)) {
        continue;
      }

      entry.controller.abort();
      return;
    }

    let cancelled = false;
    try {
      await updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          const retryIndexes = imageId
            ? turn.images.reduce<number[]>((indexes, image, index) => {
              if (image.id === imageId) {
                indexes.push(index);
              }
              return indexes;
            }, [])
            : undefined;
          if (imageId && (!retryIndexes || retryIndexes.length === 0)) {
            return turn;
          }
          cancelled = true;
          return applyTurnCanceled(turn, retryIndexes);
        }),
      }));
      if (cancelled) {
        toast.success("已取消处理");
        return;
      }
      toast.error("未找到可取消的图片任务");
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消任务失败";
      toast.error(message);
    }
  };

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
      selectedConversation,
      usesImageApiService,
      mode,
      imagePrompt,
      imageSources,
      maskSource,
      parsedCount,
      imageModel,
      imageSize,
      imageQuality,
      imageFormat,
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
    retryAbortControllersRef,
    setConversations,
    setSelectedConversationId,
    setMode,
    setImageModel,
    setImageCount,
    setImageSize,
    setImageQuality,
    setImageFormat,
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
    imageFormat,
    setImageFormat,
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
    isImageFavorited,
    handleToggleFavorite,
    seedFavoriteConfiguration,
    openSelectionEditor,
    handleSelectionEditSubmit,
    handleMaskEditorSubmit,
    handleRetryTurn,
    handleCancelRetry,
    handleSubmit,
    handleComposerCancelAction,
    composerCancelLabel,
    composerCancelTitle,
    handleEditTurn,
    handleCopyTurnPrompt,
    downloadImageFile,
  };
}
