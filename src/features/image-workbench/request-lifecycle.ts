import { startImageTask, finishImageTask } from "@/store/image-active-tasks";
import { normalizeConversation, type ImageConversation, type ImageConversationTurn } from "@/store/image-conversations";

import type { ActiveRequestState } from "./utils";
import type { SubmissionContext } from "./submission-types";

export function sortConversations(items: ImageConversation[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function beginRequest(
  ctx: SubmissionContext,
  request: ActiveRequestState,
  startedAt: number,
  retractOnEdit: boolean,
) {
  const abortController = new AbortController();
  ctx.requestAbortControllerRef.current = abortController;
  ctx.activeRequestMetaRef.current = {
    conversationId: request.conversationId,
    turnId: request.turnId,
    retractOnEdit,
  };
  ctx.setIsSubmitting(true);
  ctx.setActiveRequest(request);
  ctx.setSubmitElapsedSeconds(0);
  ctx.setSubmitStartedAt(startedAt);
  startImageTask({
    conversationId: request.conversationId,
    turnId: request.turnId,
    mode: request.mode,
    count: request.count,
    variant: request.variant,
    startedAt,
  });
  return abortController.signal;
}

export function finishRequest(ctx: SubmissionContext, conversationId: string, turnId: string) {
  ctx.requestAbortControllerRef.current = null;
  ctx.pendingAbortActionRef.current = null;
  ctx.activeRequestMetaRef.current = null;
  finishImageTask(conversationId, turnId);
  ctx.setIsSubmitting(false);
  ctx.setActiveRequest(null);
  ctx.setSubmitStartedAt(null);
}

export function buildDraftConversationFromTurn(
  existing: ImageConversation | null,
  conversationId: string,
  draftTurn: ImageConversationTurn,
): ImageConversation {
  return normalizeConversation(
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
}
