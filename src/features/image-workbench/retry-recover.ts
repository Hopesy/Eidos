import { toast } from "sonner";

import { editImage, generateImage, recoverImageTask, upscaleImage } from "@/lib/api";
import type { ImageConversationTurn, StoredImage } from "@/store/image-conversations";
import { resolveUpscaleQuality } from "@/shared/image-generation";

import type { RetryTurnContext } from "./submission-types";
import { beginRequest, finishRequest } from "./request-lifecycle";
import { applyTurnCanceled, applyTurnFailure, applyTurnGenerating, applyTurnSuccess } from "./turn-patches";
import {
  buildSourceReference,
  countFailures,
  dataUrlToFile,
  extractRequestFailureMeta,
  humanizeError,
  isCanceledRequestError,
  patchRetriedImages,
} from "./utils";

export async function runRetryTurn(
  ctx: RetryTurnContext,
  conversationId: string,
  turn: ImageConversationTurn,
  imageId?: string,
) {
  if (ctx.isSubmitting) {
    toast.error("正在处理中，请稍后再试");
    return;
  }

  const prompt = turn.prompt?.trim() ?? "";
  const turnMode = turn.mode || "generate";
  const turnSourceImages = Array.isArray(turn.sourceImages) ? turn.sourceImages : [];
  const turnImageSources = turnSourceImages.filter((item) => item.role === "image");
  const turnMaskSource = turnSourceImages.find((item) => item.role === "mask") ?? null;
  const turnUpscaleQuality = turnMode === "upscale" ? resolveUpscaleQuality(turn.imageQuality, turn.scale) : undefined;
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
  const signal = beginRequest(ctx, {
    conversationId,
    turnId,
    mode: turnMode,
    count: retryCount,
    variant: "standard",
    imageId,
  }, startedAt, false);
  ctx.focusConversation(conversationId);

  try {
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) =>
        item.id === turnId ? applyTurnGenerating(item, loadingImages) : item,
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
        signal,
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
          size: turnImageSize,
          quality: turnImageQuality,
          signal,
        });
        resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
      } else {
        const data = await generateImage(prompt, turn.model, retryIndexes.length, {
          size: turnImageSize,
          quality: turnImageQuality,
          signal,
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
        signal,
      });
      resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
    }

    if (turnMode === "upscale") {
      const file = await dataUrlToFile(turnImageSources[0].dataUrl, turnImageSources[0].name || "upscale.png");
      const data = await upscaleImage({
        image: file,
        prompt,
        quality: turnUpscaleQuality,
        model: turn.model,
        signal,
      });
      resultItems = patchRetriedImages(turn.images, retryIndexes, data.data || []);
    }

    const failedCount = countFailures(resultItems);
    const durationMs = Date.now() - startedAt;
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) =>
        item.id === turnId ? applyTurnSuccess(item, resultItems, failedCount, durationMs) : item,
      ),
    }));

    if (failedCount > 0) {
      toast.error(`已返回结果，但有 ${failedCount} 张处理失败`);
    } else {
      toast.success(turnMode === "generate" ? "图片已生成" : turnMode === "edit" ? "图片已编辑" : "图片已增强");
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
        turns: (current.turns ?? []).map((item) =>
          item.id === turnId ? applyTurnCanceled(item, retryIndexes) : item,
        ),
      }));
      return;
    }
    const message = humanizeError(error);
    const failureMeta = extractRequestFailureMeta(error);
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) =>
        item.id === turnId ? applyTurnFailure(item, message, failureMeta, retryIndexes) : item,
      ),
    }));
    toast.error(message);
  } finally {
    finishRequest(ctx, conversationId, turnId);
  }
}
