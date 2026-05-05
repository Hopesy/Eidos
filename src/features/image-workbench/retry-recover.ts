import { toast } from "sonner";

import { editImage, generateImage, recoverImageTask, upscaleImage } from "@/lib/api";
import type { ImageConversationTurn } from "@/store/image-conversations";
import { resolveUpscaleQuality } from "@/shared/image-generation";

import type { RetryTurnContext } from "./submission-types";
import { applyTurnCanceled, applyTurnFailure, applyTurnGenerating, applyTurnSuccess } from "./turn-patches";
import {
  buildSourceReference,
  countFailures,
  createResultImage,
  dataUrlToFile,
  extractRequestFailureMeta,
  humanizeError,
  isCanceledRequestError,
  mergeResultImages,
  patchRetriedImages,
} from "./utils";

const activeRetryKeys = new Set<string>();

function buildRetryKey(conversationId: string, turnId: string, imageId: string | undefined, retryIndexes: number[]) {
  return `${conversationId}:${turnId}:${imageId ?? retryIndexes.join(",")}`;
}

function keepGeneratingWhileAnyImageLoads(turn: ImageConversationTurn) {
  if (!turn.images.some((image) => image.status === "loading")) {
    return turn;
  }

  return {
    ...turn,
    status: "generating" as const,
    error: undefined,
  };
}

export function buildSharedRecoverableRetryResult(
  turn: ImageConversationTurn,
  resultPayloadItems: Parameters<typeof patchRetriedImages>[2],
) {
  const expectedCount = Math.max(1, Number(turn.count) || 1);
  const knownFileIds = Array.isArray(turn.fileIds) ? turn.fileIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const returnedFileIds = new Set(
    resultPayloadItems.map((item) => String(item.file_id || "").trim()).filter(Boolean),
  );
  const remainingFileIds = knownFileIds.length > 0
    ? knownFileIds.filter((fileId) => !returnedFileIds.has(fileId))
    : [];

  if (remainingFileIds.length === 0) {
    const images = mergeResultImages(turn.id, resultPayloadItems, expectedCount);
    return {
      images,
      failedCount: countFailures(images),
      remainingFileIds: [] as string[],
    };
  }

  const successImages = resultPayloadItems.map((item, index) => createResultImage(`${turn.id}-${index}`, item));
  return {
    images: [
      ...successImages,
      {
        id: `${turn.id}-shared-retry-error`,
        status: "error" as const,
        error: "图片结果已就绪，但下载失败。",
        failureKind: "result_fetch_failed",
        retryAction: "retry_download",
        retryable: true,
        stage: "download",
        upstreamConversationId: turn.upstreamConversationId,
      },
    ],
    failedCount: remainingFileIds.length,
    remainingFileIds,
  };
}

function preserveRetryMetaWhenFailuresRemain(previous: ImageConversationTurn, next: ImageConversationTurn) {
  if (!next.images.some((image) => image.status === "error")) {
    return next;
  }

  return {
    ...next,
    failureKind: next.failureKind ?? previous.failureKind,
    retryAction: next.retryAction ?? previous.retryAction,
    retryable: next.retryable ?? previous.retryable,
    stage: next.stage ?? previous.stage,
    upstreamConversationId: next.upstreamConversationId ?? previous.upstreamConversationId,
    upstreamResponseId: next.upstreamResponseId ?? previous.upstreamResponseId,
    imageGenerationCallId: next.imageGenerationCallId ?? previous.imageGenerationCallId,
    sourceAccountId: next.sourceAccountId ?? previous.sourceAccountId,
    fileIds: next.fileIds ?? previous.fileIds,
  };
}

async function updateConversationBestEffort(
  ctx: RetryTurnContext,
  conversationId: string,
  updater: Parameters<RetryTurnContext["updateConversation"]>[1],
) {
  try {
    await ctx.updateConversation(conversationId, updater);
  } catch (error) {
    console.error("failed to persist retry turn state", error);
    const message = error instanceof Error ? error.message : "保存重试状态失败";
    toast.error(message);
  }
}

export async function runRetryTurn(
  ctx: RetryTurnContext,
  conversationId: string,
  turn: ImageConversationTurn,
  imageId?: string,
) {
  const targetImage = imageId != null
    ? turn.images.find((image) => image.id === imageId) ?? null
    : null;
  const effectiveRetryAction = targetImage?.retryAction ?? turn.retryAction;
  const effectiveUpstreamConversationId = targetImage?.upstreamConversationId ?? turn.upstreamConversationId;
  const effectiveUpstreamResponseId = targetImage?.upstreamResponseId ?? turn.upstreamResponseId;
  const effectiveImageGenerationCallId = targetImage?.imageGenerationCallId ?? turn.imageGenerationCallId;
  const effectiveSourceAccountId = targetImage?.sourceAccountId ?? turn.sourceAccountId;
  const effectiveFileIds = targetImage?.fileIds ?? turn.fileIds;
  const prompt = turn.prompt?.trim() ?? "";
  const turnMode = turn.mode || "generate";
  const turnSourceImages = Array.isArray(turn.sourceImages) ? turn.sourceImages : [];
  const turnImageSources = turnSourceImages.filter((item) => item.role === "image");
  const turnMaskSource = turnSourceImages.find((item) => item.role === "mask") ?? null;
  const turnUpscaleQuality = turnMode === "upscale" ? resolveUpscaleQuality(turn.imageQuality, turn.scale) : undefined;
  const turnImageSize = turn.imageSize || "auto";
  const turnImageQuality = turn.imageQuality || "auto";
  const isSharedRecoverableRetry =
    !targetImage &&
    (effectiveRetryAction === "resume_polling" || effectiveRetryAction === "retry_download") &&
    Boolean(effectiveUpstreamConversationId) &&
    turn.images.length === 1 &&
    Math.max(1, Number(turn.count) || 1) > 1 &&
    turn.images[0]?.status === "error";
  const failedIndexes = turn.images
    .map((image, index) => (image.status === "error" ? index : -1))
    .filter((index) => index >= 0);
  const retryIndexes =
    isSharedRecoverableRetry
      ? failedIndexes
      : imageId != null
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
  if (retryIndexes.some((index) => turn.images[index]?.status === "loading")) {
    toast.error("该图片正在处理中");
    return;
  }

  const retryKey = buildRetryKey(conversationId, turn.id, imageId, retryIndexes);
  if (activeRetryKeys.has(retryKey)) {
    toast.error("该图片正在处理中");
    return;
  }
  activeRetryKeys.add(retryKey);

  const turnId = turn.id;
  const startedAt = Date.now();
  const abortController = new AbortController();
  const signal = abortController.signal;
  ctx.focusConversation(conversationId);

  try {
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) => {
        if (item.id !== turnId) {
          return item;
        }

        const loadingImages = item.images.map((image, index) =>
          retryIndexes.includes(index)
            ? {
              id: image.id,
              status: "loading" as const,
            }
            : image,
        );
        return applyTurnGenerating(item, loadingImages);
      }),
    }));

    let resultPayloadItems: Parameters<typeof patchRetriedImages>[2] = [];
    if ((effectiveRetryAction === "resume_polling" || effectiveRetryAction === "retry_download") && effectiveUpstreamConversationId) {
      const data = await recoverImageTask({
        conversationId: effectiveUpstreamConversationId,
        sourceAccountId: effectiveSourceAccountId,
        revisedPrompt: prompt,
        fileIds: effectiveFileIds,
        waitMs: effectiveRetryAction === "resume_polling" ? 60000 : 15000,
        model: turn.model,
        mode: turnMode,
        signal,
      });
      resultPayloadItems = data.data || [];
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
        resultPayloadItems = data.data || [];
      } else {
        const data = await generateImage(prompt, turn.model, retryIndexes.length, {
          size: turnImageSize,
          quality: turnImageQuality,
          signal,
        });
        resultPayloadItems = data.data || [];
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
      resultPayloadItems = data.data || [];
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
      resultPayloadItems = data.data || [];
    }

    const durationMs = Date.now() - startedAt;
    let failedCount = 0;
    let retriedFailedCount = 0;
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) => {
        if (item.id !== turnId) {
          return item;
        }

        if (isSharedRecoverableRetry) {
          const sharedResult = buildSharedRecoverableRetryResult(item, resultPayloadItems);
          failedCount = sharedResult.failedCount;
          retriedFailedCount = sharedResult.failedCount;
          return {
            ...item,
            images: sharedResult.images,
            status: sharedResult.failedCount > 0 ? "error" as const : "success" as const,
            error: sharedResult.failedCount > 0 ? `其中 ${sharedResult.failedCount} 张处理失败` : undefined,
            durationMs,
            failureKind: sharedResult.failedCount > 0 ? "result_fetch_failed" : undefined,
            retryAction: sharedResult.failedCount > 0 ? "retry_download" : undefined,
            retryable: sharedResult.failedCount > 0 ? true : undefined,
            stage: sharedResult.failedCount > 0 ? "download" : undefined,
            upstreamConversationId: sharedResult.failedCount > 0 ? effectiveUpstreamConversationId : undefined,
            upstreamResponseId: sharedResult.failedCount > 0 ? effectiveUpstreamResponseId : undefined,
            imageGenerationCallId: sharedResult.failedCount > 0 ? effectiveImageGenerationCallId : undefined,
            sourceAccountId: sharedResult.failedCount > 0 ? effectiveSourceAccountId : undefined,
            fileIds: sharedResult.failedCount > 0 ? sharedResult.remainingFileIds : undefined,
          };
        }

        const resultItems = patchRetriedImages(item.images, retryIndexes, resultPayloadItems);
        failedCount = countFailures(resultItems);
        retriedFailedCount = retryIndexes.filter((index) => resultItems[index]?.status === "error").length;
        return keepGeneratingWhileAnyImageLoads(
          preserveRetryMetaWhenFailuresRemain(
            item,
            applyTurnSuccess(item, resultItems, failedCount, durationMs),
          ),
        );
      }),
    }));

    if (retriedFailedCount > 0) {
      toast.error(`重试完成，但有 ${retriedFailedCount} 张仍处理失败`);
    } else {
      toast.success(turnMode === "generate" ? "图片已生成" : turnMode === "edit" ? "图片已编辑" : "图片已增强");
    }
  } catch (error) {
    if (isCanceledRequestError(error)) {
      await updateConversationBestEffort(ctx, conversationId, (current) => ({
        ...current,
        turns: (current.turns ?? []).map((item) => {
          if (item.id !== turnId) {
            return item;
          }

          return keepGeneratingWhileAnyImageLoads(applyTurnCanceled(item, retryIndexes));
        }),
      }));
      return;
    }
    const message = humanizeError(error);
    const failureMeta = extractRequestFailureMeta(error);
    await updateConversationBestEffort(ctx, conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((item) => {
        if (item.id !== turnId) {
          return item;
        }

        return keepGeneratingWhileAnyImageLoads(applyTurnFailure(item, message, failureMeta, retryIndexes));
      }),
    }));
    toast.error(message);
  } finally {
    activeRetryKeys.delete(retryKey);
  }
}
