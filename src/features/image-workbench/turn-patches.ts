import type { ImageConversationTurn, StoredImage } from "@/store/image-conversations";

export type RequestFailureMeta = {
  failureKind?: string;
  retryAction?: string;
  retryable?: boolean;
  stage?: string;
  upstreamConversationId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
};

function clearFailureMeta() {
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

function shouldPatchImage(index: number, retryIndexes?: number[]) {
  return !retryIndexes || retryIndexes.includes(index);
}

function shouldCollapseSharedRecoverableFailure(
  turn: ImageConversationTurn,
  failureMeta: RequestFailureMeta,
  retryIndexes?: number[],
) {
  if (retryIndexes && retryIndexes.length > 0) {
    return false;
  }
  if (turn.images.length <= 1) {
    return false;
  }
  if (failureMeta.retryAction !== "resume_polling" && failureMeta.retryAction !== "retry_download") {
    return false;
  }
  return !turn.images.some((image) => image.status === "success");
}

export function applyTurnGenerating(turn: ImageConversationTurn, images: StoredImage[]) {
  return {
    ...turn,
    status: "generating" as const,
    error: undefined,
    ...clearFailureMeta(),
    images,
  };
}

export function applyTurnSuccess(
  turn: ImageConversationTurn,
  resultItems: StoredImage[],
  failedCount: number,
  durationMs: number,
) {
  return {
    ...turn,
    images: resultItems,
    status: failedCount > 0 ? "error" as const : "success" as const,
    error: failedCount > 0 ? `其中 ${failedCount} 张处理失败` : undefined,
    durationMs,
    ...clearFailureMeta(),
  };
}

export function applyTurnCanceled(
  turn: ImageConversationTurn,
  retryIndexes?: number[],
) {
  return {
    ...turn,
    status: "error" as const,
    error: "已取消生成",
    images: turn.images.map((image, index) =>
      shouldPatchImage(index, retryIndexes)
        ? {
          ...image,
          status: "error" as const,
          error: "已取消生成",
        }
        : image,
    ),
  };
}

export function applyTurnFailure(
  turn: ImageConversationTurn,
  message: string,
  failureMeta: RequestFailureMeta,
  retryIndexes?: number[],
) {
  if (shouldCollapseSharedRecoverableFailure(turn, failureMeta, retryIndexes)) {
    return {
      ...turn,
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
      images: [
        {
          id: turn.images[0]?.id || `${turn.id}-shared-error`,
          status: "error" as const,
          error: message,
          failureKind: failureMeta.failureKind,
          retryAction: failureMeta.retryAction,
          retryable: failureMeta.retryable,
          stage: failureMeta.stage,
          upstreamConversationId: failureMeta.upstreamConversationId,
          upstreamResponseId: failureMeta.upstreamResponseId,
          imageGenerationCallId: failureMeta.imageGenerationCallId,
        },
      ],
    };
  }

  return {
    ...turn,
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
    images: turn.images.map((image, index) =>
      shouldPatchImage(index, retryIndexes)
        ? {
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
        }
        : image,
    ),
  };
}
