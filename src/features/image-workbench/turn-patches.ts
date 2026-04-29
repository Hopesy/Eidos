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
        }
        : image,
    ),
  };
}
