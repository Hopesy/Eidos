import { toast } from "sonner";

import { editImage } from "@/lib/api";

import { beginRequest, finishRequest } from "./request-lifecycle";
import type { SelectionEditContext, SelectionEditParams } from "./submission-types";
import { applyTurnCanceled, applyTurnFailure, applyTurnSuccess } from "./turn-patches";
import {
  buildConversationTitle,
  buildSourceReference,
  countFailures,
  createConversationTurn,
  createLoadingImages,
  createSourceImageFromResult,
  dataUrlToFile,
  extractRequestFailureMeta,
  humanizeError,
  isCanceledRequestError,
  makeId,
  mergeResultImages,
} from "./utils";
export async function runSelectionEditSubmit(
  ctx: SelectionEditContext,
  params: SelectionEditParams,
) {
  const { editorTarget, imageModel } = ctx;
  if (!editorTarget) {
    return;
  }

  const { prompt, mask } = params;
  const conversationId = editorTarget.conversationId;
  const turnId = makeId();
  const now = new Date().toISOString();
  const selectionSourceImage = createSourceImageFromResult(editorTarget.image, editorTarget.imageName || "source.png");
  const draftTurn = createConversationTurn({
    turnId,
    title: buildConversationTitle("edit", prompt),
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
  const signal = beginRequest(ctx, {
    conversationId,
    turnId,
    mode: "edit",
    count: 1,
    variant: "selection-edit",
  }, startedAt, true);
  ctx.focusConversation(conversationId);
  ctx.setImagePrompt("");
  ctx.setSourceImages([]);
  ctx.setEditorTarget(null);

  try {
    await ctx.updateConversation(conversationId, (current) => ({
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
      signal,
    });
    const resultItems = mergeResultImages(turnId, data.data || [], 1);
    const failedCount = countFailures(resultItems);
    const durationMs = Date.now() - startedAt;

    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((turn) =>
        turn.id === turnId ? applyTurnSuccess(turn, resultItems, failedCount, durationMs) : turn,
      ),
    }));

    if (failedCount > 0) {
      toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
    } else {
      toast.success("图片已按选区编辑");
    }
  } catch (error) {
    if (isCanceledRequestError(error)) {
      const pendingAbortAction = ctx.pendingAbortActionRef.current;
      if (
        pendingAbortAction?.conversationId === conversationId &&
        pendingAbortAction?.turnId === turnId &&
        pendingAbortAction.retractTurn
      ) {
        ctx.pendingAbortActionRef.current = null;
        await ctx.retractTurnAfterAbort(conversationId, turnId);
        return;
      }
      await ctx.updateConversation(conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((turn) =>
          turn.id === turnId ? applyTurnCanceled(turn) : turn,
        ),
      }));
      return;
    }
    const message = humanizeError(error);
    const failureMeta = extractRequestFailureMeta(error);
    if (failureMeta.failureKind === "input_blocked" && failureMeta.retryAction === "revise_input") {
      const conversationStillExists = await ctx.retractTurnAfterAbort(conversationId, turnId);
      ctx.restoreComposerFromTurn(conversationStillExists ? conversationId : null, draftTurn, "请修改提示词后重试");
      return;
    }
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((turn) =>
        turn.id === turnId ? applyTurnFailure(turn, message, failureMeta) : turn,
      ),
    }));
    toast.error(message);
  } finally {
    finishRequest(ctx, conversationId, turnId);
  }
}

