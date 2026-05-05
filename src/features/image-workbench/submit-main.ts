import { toast } from "sonner";

import { editImage, generateImage, upscaleImage } from "@/lib/api";
import { type StoredImage } from "@/store/image-conversations";
import { resolveImageGenerationSize } from "@/shared/image-generation";

import { beginRequest, buildDraftConversationFromTurn, finishRequest, sortConversations } from "./request-lifecycle";
import type { SubmitContext } from "./submission-types";
import { applyTurnCanceled, applyTurnFailure, applyTurnSuccess } from "./turn-patches";
import {
  buildConversationTitle,
  buildSourceReference,
  countFailures,
  createResultImage,
  createConversationTurn,
  createLoadingImages,
  dataUrlToFile,
  extractRequestFailureMeta,
  humanizeError,
  isCanceledRequestError,
  makeId,
  mergeResultImages,
} from "./utils";

function clearTurnFailureMeta() {
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

function patchTurnImages(turn: ReturnType<typeof createConversationTurn>, images: StoredImage[], durationMs?: number) {
  const failedCount = countFailures(images);
  const hasLoading = images.some((image) => image.status === "loading");
  return {
    ...turn,
    images,
    status: hasLoading ? "generating" as const : failedCount > 0 ? "error" as const : "success" as const,
    error: hasLoading ? undefined : failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
    durationMs,
    ...clearTurnFailureMeta(),
  };
}

function patchSingleTurnImage(
  turn: ReturnType<typeof createConversationTurn>,
  slotIndex: number,
  nextImage: StoredImage,
  durationMs: number,
) {
  const nextImages = turn.images.map((image, index) => (index === slotIndex ? nextImage : image));
  return patchTurnImages(turn, nextImages, durationMs);
}

function patchSingleTurnFailure(
  turn: ReturnType<typeof createConversationTurn>,
  slotIndex: number,
  message: string,
  failureMeta: ReturnType<typeof extractRequestFailureMeta>,
  durationMs: number,
) {
  const currentImage = turn.images[slotIndex];
  if (!currentImage) {
    return turn;
  }
  return patchSingleTurnImage(
    turn,
    slotIndex,
    {
      ...currentImage,
      status: "error" as const,
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
    },
    durationMs,
  );
}

function isPromptRevisionFailure(failureMeta: ReturnType<typeof extractRequestFailureMeta>) {
  return failureMeta.failureKind === "input_blocked" && failureMeta.retryAction === "revise_input";
}

function isSourceInvalidFailure(failureMeta: ReturnType<typeof extractRequestFailureMeta>) {
  return failureMeta.failureKind === "source_invalid";
}
export async function runSubmit(ctx: SubmitContext) {
  const {
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
  } = ctx;

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
    toast.error("增强模式需要一张源图");
    return;
  }

  const conversationId = selectedConversationId ?? makeId();
  const turnId = makeId();
  const now = new Date().toISOString();
  const expectedCount = mode === "generate" && imageSources.length === 0 ? parsedCount : 1;
  const draftTurn = createConversationTurn({
    turnId,
    title: buildConversationTitle(mode, prompt, upscaleQuality),
    mode,
    prompt,
    model: imageModel,
    imageSize: mode === "generate" ? resolveImageGenerationSize(imageSize, imageQuality) : "auto",
    imageQuality: mode === "generate" ? imageQuality : mode === "upscale" ? upscaleQuality : "auto",
    count: expectedCount,
    sourceImages,
    images: createLoadingImages(expectedCount, turnId),
    createdAt: now,
    status: "generating",
  });
  const draftLoadingImages = draftTurn.images;

  const startedAt = Date.now();
  const signal = beginRequest(ctx, {
    conversationId,
    turnId,
    mode,
    count: expectedCount,
    variant: "standard",
  }, startedAt, true);
  ctx.focusConversation(conversationId);
  ctx.setImagePrompt("");
  ctx.setSourceImages([]);

  try {
    if (ctx.mountedRef.current) {
      ctx.setConversations((prev) => {
        const existing = prev.find((item) => item.id === conversationId) ?? null;
        const nextConversation = buildDraftConversationFromTurn(existing, conversationId, draftTurn);
        return sortConversations([nextConversation, ...prev.filter((item) => item.id !== conversationId)]);
      });
    }

    if (selectedConversationId) {
      await ctx.updateConversation(conversationId, (current) => ({
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
      await ctx.persistConversation({
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
          size: resolveImageGenerationSize(imageSize, imageQuality),
          quality: imageQuality,
          signal,
        });
        resultItems = mergeResultImages(turnId, data.data || [], 1);
      } else {
        if (parsedCount > 1) {
          const slotCount = parsedCount;
          const slotConcurrency = ctx.usesImageApiService ? slotCount : 1;
          let succeededCount = 0;
          let failedCount = 0;
          let nextSlotIndex = 0;
          let restoredComposer = false;
          let stopDispatch = false;
          const settledSlotIndexes = new Set<number>();

          const handlePromptFailure = async () => {
            stopDispatch = true;
            restoredComposer = true;
            ctx.requestAbortControllerRef.current?.abort();
            const conversationStillExists = await ctx.retractTurnAfterAbort(conversationId, turnId);
            ctx.restoreComposerFromTurn(conversationStillExists ? conversationId : null, draftTurn, "请修改提示词后重试");
          };

          const handleSlot = async () => {
            while (!stopDispatch && !signal.aborted) {
              const slotIndex = nextSlotIndex;
              nextSlotIndex += 1;
              if (slotIndex >= slotCount) {
                return;
              }

              try {
                const data = await generateImage(prompt, imageModel, 1, {
                  size: resolveImageGenerationSize(imageSize, imageQuality),
                  quality: imageQuality,
                  signal,
                });
                const resultImage = createResultImage(
                  draftLoadingImages[slotIndex]?.id || `${turnId}-${slotIndex}`,
                  data.data?.[0],
                );
                settledSlotIndexes.add(slotIndex);
                if (resultImage.status === "success") {
                  succeededCount += 1;
                } else {
                  failedCount += 1;
                }
                await ctx.updateConversation(conversationId, (current) => ({
                  ...current,
                  turns: (current.turns ?? []).map((turn) =>
                    turn.id === turnId
                      ? patchSingleTurnImage(turn, slotIndex, resultImage, Date.now() - startedAt)
                      : turn,
                  ),
                }));
              } catch (error) {
                if (isCanceledRequestError(error)) {
                  if (restoredComposer || stopDispatch) {
                    return;
                  }
                  throw error;
                }
                const failureMeta = extractRequestFailureMeta(error);
                const message = humanizeError(error);
                settledSlotIndexes.add(slotIndex);
                if (isPromptRevisionFailure(failureMeta) && succeededCount === 0) {
                  await handlePromptFailure();
                  return;
                }
                failedCount += 1;
                await ctx.updateConversation(conversationId, (current) => ({
                  ...current,
                  turns: (current.turns ?? []).map((turn) =>
                    turn.id === turnId
                      ? patchSingleTurnFailure(turn, slotIndex, message, failureMeta, Date.now() - startedAt)
                      : turn,
                  ),
                }));
                if (!ctx.usesImageApiService && (isPromptRevisionFailure(failureMeta) || isSourceInvalidFailure(failureMeta))) {
                  stopDispatch = true;
                  const remainingFailedCount = draftLoadingImages.length - settledSlotIndexes.size;
                  failedCount += Math.max(0, remainingFailedCount);
                  await ctx.updateConversation(conversationId, (current) => ({
                    ...current,
                    turns: (current.turns ?? []).map((turn) => {
                      if (turn.id !== turnId) {
                        return turn;
                      }
                      const nextImages = turn.images.map((image, index) => {
                        if (settledSlotIndexes.has(index) || image.status !== "loading") {
                          return image;
                        }
                        return {
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
                          sourceAccountId: failureMeta.sourceAccountId,
                          fileIds: failureMeta.fileIds,
                        };
                      });
                      return patchTurnImages(turn, nextImages, Date.now() - startedAt);
                    }),
                  }));
                  return;
                }
              }
            }
          };

          await Promise.all(
            Array.from({ length: slotConcurrency }, () => handleSlot()),
          );

          if (restoredComposer) {
            return;
          }

          const durationMs = Date.now() - startedAt;
          await ctx.updateConversation(conversationId, (current) => ({
            ...current,
            turns: (current.turns ?? []).map((turn) => {
              if (turn.id !== turnId) {
                return turn;
              }
              return patchTurnImages(turn, turn.images, durationMs);
            }),
          }));

          ctx.resetComposer("generate", {
            preserveImageSize: true,
            preserveImageQuality: true,
          });
          if (failedCount > 0) {
            toast.error(
              succeededCount > 0
                ? `已返回结果，但有 ${failedCount} 张处理失败`
                : `共 ${failedCount} 张处理失败`,
            );
          } else {
            toast.success("图片已生成");
          }
          return;
        }

        const data = await generateImage(prompt, imageModel, parsedCount, {
          size: resolveImageGenerationSize(imageSize, imageQuality),
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
      const data = await upscaleImage({
        image: file,
        prompt,
        quality: upscaleQuality,
        model: imageModel,
        signal,
      });
      resultItems = mergeResultImages(turnId, data.data || [], 1);
    }

    const failedCount = countFailures(resultItems);
    const durationMs = Date.now() - startedAt;
    await ctx.updateConversation(conversationId, (current) => ({
      ...current,
      turns: (current.turns ?? []).map((turn) =>
        turn.id === turnId ? applyTurnSuccess(turn, resultItems, failedCount, durationMs) : turn,
      ),
    }));

    ctx.resetComposer(mode === "generate" ? "generate" : mode, {
      preserveImageSize: mode === "generate",
      preserveImageQuality: mode === "generate",
      preserveUpscaleQuality: mode === "upscale",
    });
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
            : "图片已增强",
      );
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
    const failureMeta = extractRequestFailureMeta(error);
    const message = humanizeError(error);
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
