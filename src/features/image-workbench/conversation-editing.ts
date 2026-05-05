import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ImageGenerationQuality, ImageModel } from "@/lib/api";
import { deleteImageConversation, getImageConversation, type ImageConversation, type ImageConversationTurn, type ImageMode, type StoredSourceImage } from "@/store/image-conversations";
import { resolveImageRatioFromSize, resolveUpscaleQuality, type ImageRatioOption } from "@/shared/image-generation";
import type { ActiveRequestMeta, EditorTarget, PendingAbortAction } from "./submission";
import { cloneSourceImagesForComposer, type ActiveRequestState } from "./utils";

const DEFAULT_GENERATE_IMAGE_RATIO: ImageRatioOption = "1:1";
const DEFAULT_IMAGE_QUALITY: ImageGenerationQuality = "medium";
const DEFAULT_UPSCALE_QUALITY: ImageGenerationQuality = "medium";

type UpdateConversationFn = (
  conversationId: string,
  updater: (current: ImageConversation) => ImageConversation,
) => Promise<void>;

type WorkspaceCacheState = {
  selectedConversationId: string | null;
  isDraftSelection: boolean;
};

type ConversationEditingContext = {
  mountedRef: MutableRefObject<boolean>;
  draftSelectionRef: MutableRefObject<boolean>;
  requestAbortControllerRef: MutableRefObject<AbortController | null>;
  pendingAbortActionRef: MutableRefObject<PendingAbortAction | null>;
  activeRequestMetaRef: MutableRefObject<ActiveRequestMeta | null>;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  isSubmitting: boolean;
  activeRequest: ActiveRequestState | null;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<ImageMode>>;
  setImageModel: Dispatch<SetStateAction<ImageModel>>;
  setImageCount: Dispatch<SetStateAction<string>>;
  setImageSize: Dispatch<SetStateAction<ImageRatioOption>>;
  setImageQuality: Dispatch<SetStateAction<ImageGenerationQuality>>;
  setUpscaleQuality: Dispatch<SetStateAction<ImageGenerationQuality>>;
  setReuseLatestResultForGenerate: Dispatch<SetStateAction<boolean>>;
  setSourceImages: Dispatch<SetStateAction<StoredSourceImage[]>>;
  setImagePrompt: Dispatch<SetStateAction<string>>;
  setEditorTarget: Dispatch<SetStateAction<EditorTarget | null>>;
  setCachedWorkspaceState: (state: WorkspaceCacheState) => void;
  focusConversation: (conversationId: string) => void;
  openDraftConversation: () => void;
  updateConversation: UpdateConversationFn;
};

type ToolbarStateContext = Pick<
  ConversationEditingContext,
  "setMode" | "setImageModel" | "setImageCount" | "setImageSize" | "setImageQuality" | "setUpscaleQuality"
>;

export function getLatestConversationTurn(conversation: ImageConversation | null): ImageConversationTurn | null {
  const turns = conversation?.turns ?? [];
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

export function applyComposerToolbarStateFromTurn(
  ctx: ToolbarStateContext,
  turn: ImageConversationTurn,
) {
  ctx.setMode(turn.mode);
  ctx.setImageModel(turn.model);
  ctx.setImageCount(String(Math.max(1, Number(turn.count) || 1)));

  if (turn.mode === "generate") {
    ctx.setImageSize(resolveImageRatioFromSize(turn.imageSize));
    ctx.setImageQuality(turn.imageQuality ?? DEFAULT_IMAGE_QUALITY);
    ctx.setUpscaleQuality(DEFAULT_UPSCALE_QUALITY);
    return;
  }

  ctx.setImageSize(DEFAULT_GENERATE_IMAGE_RATIO);
  ctx.setImageQuality(DEFAULT_IMAGE_QUALITY);

  if (turn.mode === "upscale") {
    ctx.setUpscaleQuality(resolveUpscaleQuality(turn.imageQuality, turn.scale));
    return;
  }

  ctx.setUpscaleQuality(DEFAULT_UPSCALE_QUALITY);
}

export async function retractTurnAfterAbort(
  ctx: Pick<ConversationEditingContext, "mountedRef" | "draftSelectionRef" | "setConversations" | "setSelectedConversationId" | "setCachedWorkspaceState" | "updateConversation">,
  conversationId: string,
  turnId: string,
) {
  const conversation = await getImageConversation(conversationId);
  if (!conversation) {
    return false;
  }

  const remainingTurns = (conversation.turns ?? []).filter((turn) => turn.id !== turnId);
  if (remainingTurns.length === 0) {
    await deleteImageConversation(conversationId);
    if (!ctx.mountedRef.current) {
      return false;
    }

    ctx.setConversations((prev) => prev.filter((item) => item.id !== conversationId));
    ctx.setSelectedConversationId((current) => {
      if (current !== conversationId) {
        return current;
      }
      ctx.draftSelectionRef.current = true;
      ctx.setCachedWorkspaceState({
        selectedConversationId: null,
        isDraftSelection: true,
      });
      return null;
    });
    return false;
  }

  const latestTurn = remainingTurns[remainingTurns.length - 1];
  await ctx.updateConversation(conversationId, (current) => ({
    ...current,
    title: latestTurn.title,
    mode: latestTurn.mode,
    prompt: latestTurn.prompt,
    model: latestTurn.model,
    imageSize: latestTurn.imageSize,
    imageQuality: latestTurn.imageQuality,
    count: latestTurn.count,
    scale: latestTurn.scale,
    sourceImages: latestTurn.sourceImages ?? [],
    images: latestTurn.images,
    createdAt: latestTurn.createdAt,
    status: latestTurn.status,
    error: latestTurn.error,
    turns: remainingTurns,
  }));
  return true;
}

export function restoreComposerFromTurn(
  ctx: Pick<ConversationEditingContext, "isSubmitting" | "activeRequest" | "focusConversation" | "openDraftConversation" | "setMode" | "setImageModel" | "setImageCount" | "setImageSize" | "setImageQuality" | "setUpscaleQuality" | "setReuseLatestResultForGenerate" | "setSourceImages" | "setImagePrompt" | "setEditorTarget" | "textareaRef">,
  conversationId: string | null,
  turn: ImageConversationTurn,
  successMessage?: string,
) {
  const isActiveTurn = Boolean(
    ctx.isSubmitting &&
    ctx.activeRequest &&
    conversationId &&
    ctx.activeRequest.conversationId === conversationId &&
    ctx.activeRequest.turnId === turn.id,
  );

  if (ctx.isSubmitting && !isActiveTurn) {
    toast.error("当前还有其他任务在处理中，暂时不能切换编辑");
    return;
  }

  if (conversationId) {
    ctx.focusConversation(conversationId);
  } else {
    ctx.openDraftConversation();
  }

  applyComposerToolbarStateFromTurn(ctx, turn);

  ctx.setReuseLatestResultForGenerate(false);
  ctx.setSourceImages(cloneSourceImagesForComposer(turn.sourceImages ?? []));
  ctx.setImagePrompt(turn.prompt || "");
  ctx.setEditorTarget(null);

  window.requestAnimationFrame(() => {
    ctx.textareaRef.current?.focus();
    const length = turn.prompt?.length ?? 0;
    if (ctx.textareaRef.current) {
      ctx.textareaRef.current.selectionStart = length;
      ctx.textareaRef.current.selectionEnd = length;
    }
  });

  if (successMessage) {
    toast.success(successMessage);
  }
}

export async function handleEditTurn(
  ctx: Pick<ConversationEditingContext, "isSubmitting" | "activeRequest" | "pendingAbortActionRef" | "activeRequestMetaRef" | "requestAbortControllerRef"> &
    Pick<ConversationEditingContext, "mountedRef" | "draftSelectionRef" | "setConversations" | "setSelectedConversationId" | "setCachedWorkspaceState" | "updateConversation"> &
    Pick<ConversationEditingContext, "focusConversation" | "openDraftConversation" | "setMode" | "setImageModel" | "setImageCount" | "setImageSize" | "setImageQuality" | "setUpscaleQuality" | "setReuseLatestResultForGenerate" | "setSourceImages" | "setImagePrompt" | "setEditorTarget" | "textareaRef">,
  conversationId: string,
  turn: ImageConversationTurn,
) {
  const isActiveTurn = Boolean(
    ctx.isSubmitting &&
    ctx.activeRequest &&
    ctx.activeRequest.conversationId === conversationId &&
    ctx.activeRequest.turnId === turn.id,
  );

  if (ctx.isSubmitting && !isActiveTurn) {
    toast.error("当前还有其他任务在处理中，暂时不能切换编辑");
    return;
  }

  if (isActiveTurn) {
    ctx.pendingAbortActionRef.current = {
      conversationId,
      turnId: turn.id,
      retractTurn:
        ctx.activeRequestMetaRef.current?.conversationId === conversationId &&
        ctx.activeRequestMetaRef.current?.turnId === turn.id &&
        ctx.activeRequestMetaRef.current?.retractOnEdit === true,
    };
    ctx.requestAbortControllerRef.current?.abort();
  }

  if (!isActiveTurn && turn.status === "error") {
    const conversationStillExists = await retractTurnAfterAbort(ctx, conversationId, turn.id);
    restoreComposerFromTurn(
      ctx,
      conversationStillExists ? conversationId : null,
      turn,
      "已撤回失败请求，可修改提示词后重新发送",
    );
    return;
  }

  restoreComposerFromTurn(
    ctx,
    conversationId,
    turn,
    isActiveTurn ? "已中断当前任务，可修改提示词后重新发送" : "已将本轮输入回填到编辑器",
  );
}

export function handleCancelAndEditActiveRequest(
  ctx: Pick<ConversationEditingContext, "activeRequest"> &
    Pick<ConversationEditingContext, "isSubmitting" | "pendingAbortActionRef" | "activeRequestMetaRef" | "requestAbortControllerRef"> &
    Pick<ConversationEditingContext, "mountedRef" | "draftSelectionRef" | "setConversations" | "setSelectedConversationId" | "setCachedWorkspaceState" | "updateConversation"> &
    Pick<ConversationEditingContext, "focusConversation" | "openDraftConversation" | "setMode" | "setImageModel" | "setImageCount" | "setImageSize" | "setImageQuality" | "setUpscaleQuality" | "setReuseLatestResultForGenerate" | "setSourceImages" | "setImagePrompt" | "setEditorTarget" | "textareaRef">,
  conversations: ImageConversation[],
) {
  if (!ctx.activeRequest) {
    toast.error("当前没有可编辑的进行中任务");
    return;
  }

  const conversation = conversations.find((item) => item.id === ctx.activeRequest?.conversationId);
  const turn = conversation?.turns?.find((item) => item.id === ctx.activeRequest?.turnId);
  if (!conversation || !turn) {
    toast.error("未找到当前进行中的输入记录");
    return;
  }

  void handleEditTurn(ctx, conversation.id, turn);
}
