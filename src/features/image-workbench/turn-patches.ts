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
  statusCode?: number;
  lastPollStatus?: number;
  pollStatusCounts?: Record<string, number>;
  pollAttempts?: number;
  retryAfterMs?: number;
  upstreamBodyPreview?: string;
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
    statusCode: undefined,
    lastPollStatus: undefined,
    pollStatusCounts: undefined,
    pollAttempts: undefined,
    retryAfterMs: undefined,
    upstreamBodyPreview: undefined,
  };
}

function mergeFailureMeta(
  failureMeta: RequestFailureMeta,
  fallback?: RequestFailureMeta,
): RequestFailureMeta {
  const retryAction = failureMeta.retryAction ?? fallback?.retryAction;
  const canPreserveRecoveryContext = retryAction === "resume_polling" || retryAction === "retry_download";
  return {
    failureKind: failureMeta.failureKind ?? fallback?.failureKind,
    retryAction,
    retryable: failureMeta.retryable ?? fallback?.retryable,
    stage: failureMeta.stage ?? fallback?.stage,
    upstreamConversationId: failureMeta.upstreamConversationId ?? (canPreserveRecoveryContext ? fallback?.upstreamConversationId : undefined),
    upstreamResponseId: failureMeta.upstreamResponseId ?? (canPreserveRecoveryContext ? fallback?.upstreamResponseId : undefined),
    imageGenerationCallId: failureMeta.imageGenerationCallId ?? (canPreserveRecoveryContext ? fallback?.imageGenerationCallId : undefined),
    sourceAccountId: failureMeta.sourceAccountId ?? (canPreserveRecoveryContext ? fallback?.sourceAccountId : undefined),
    fileIds: failureMeta.fileIds ?? (canPreserveRecoveryContext ? fallback?.fileIds : undefined),
    statusCode: failureMeta.statusCode ?? fallback?.statusCode,
    lastPollStatus: failureMeta.lastPollStatus ?? fallback?.lastPollStatus,
    pollStatusCounts: failureMeta.pollStatusCounts ?? fallback?.pollStatusCounts,
    pollAttempts: failureMeta.pollAttempts ?? fallback?.pollAttempts,
    retryAfterMs: failureMeta.retryAfterMs ?? fallback?.retryAfterMs,
    upstreamBodyPreview: failureMeta.upstreamBodyPreview ?? fallback?.upstreamBodyPreview,
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

export function applyTurnGenerating(
  turn: ImageConversationTurn,
  images: StoredImage[],
  preserveMeta?: RequestFailureMeta,
) {
  return {
    ...turn,
    status: "generating" as const,
    error: undefined,
    ...clearFailureMeta(),
    ...(preserveMeta ? mergeFailureMeta(preserveMeta) : {}),
    images,
  };
}

export function applyTurnSuccess(
  turn: ImageConversationTurn,
  resultItems: StoredImage[],
  failedCount: number,
  durationMs: number,
) {
  const finishedAt = Date.now();
  return {
    ...turn,
    images: resultItems.map((image, index) => {
      const previous = turn.images[index];
      return {
        ...image,
        startedAt: image.startedAt ?? previous?.startedAt,
        durationMs: image.durationMs ?? (previous?.startedAt ? finishedAt - previous.startedAt : durationMs),
      };
    }),
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
          durationMs: image.startedAt ? Date.now() - image.startedAt : image.durationMs,
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
  const meta = mergeFailureMeta(failureMeta, turn);
  if (shouldCollapseSharedRecoverableFailure(turn, meta, retryIndexes)) {
    return {
      ...turn,
      status: "error" as const,
      error: message,
      failureKind: meta.failureKind,
      retryAction: meta.retryAction,
      retryable: meta.retryable,
      stage: meta.stage,
      upstreamConversationId: meta.upstreamConversationId,
      upstreamResponseId: meta.upstreamResponseId,
      imageGenerationCallId: meta.imageGenerationCallId,
      sourceAccountId: meta.sourceAccountId,
      fileIds: meta.fileIds,
      statusCode: meta.statusCode,
      lastPollStatus: meta.lastPollStatus,
      pollStatusCounts: meta.pollStatusCounts,
      pollAttempts: meta.pollAttempts,
      retryAfterMs: meta.retryAfterMs,
      upstreamBodyPreview: meta.upstreamBodyPreview,
      images: [
        {
          id: turn.images[0]?.id || `${turn.id}-shared-error`,
          status: "error" as const,
          startedAt: turn.images[0]?.startedAt,
          durationMs: turn.images[0]?.startedAt ? Date.now() - turn.images[0].startedAt : undefined,
          error: message,
          failureKind: meta.failureKind,
          retryAction: meta.retryAction,
          retryable: meta.retryable,
          stage: meta.stage,
          upstreamConversationId: meta.upstreamConversationId,
          upstreamResponseId: meta.upstreamResponseId,
          imageGenerationCallId: meta.imageGenerationCallId,
          sourceAccountId: meta.sourceAccountId,
          fileIds: meta.fileIds,
          statusCode: meta.statusCode,
          lastPollStatus: meta.lastPollStatus,
          pollStatusCounts: meta.pollStatusCounts,
          pollAttempts: meta.pollAttempts,
          retryAfterMs: meta.retryAfterMs,
          upstreamBodyPreview: meta.upstreamBodyPreview,
        },
      ],
    };
  }

  return {
    ...turn,
    status: "error" as const,
    error: message,
    failureKind: meta.failureKind,
    retryAction: meta.retryAction,
    retryable: meta.retryable,
    stage: meta.stage,
    upstreamConversationId: meta.upstreamConversationId,
    upstreamResponseId: meta.upstreamResponseId,
    imageGenerationCallId: meta.imageGenerationCallId,
    sourceAccountId: meta.sourceAccountId,
    fileIds: meta.fileIds,
    statusCode: meta.statusCode,
    lastPollStatus: meta.lastPollStatus,
    pollStatusCounts: meta.pollStatusCounts,
    pollAttempts: meta.pollAttempts,
    retryAfterMs: meta.retryAfterMs,
    upstreamBodyPreview: meta.upstreamBodyPreview,
    images: turn.images.map((image, index) =>
      shouldPatchImage(index, retryIndexes)
        ? {
          ...image,
          status: "error" as const,
          durationMs: image.startedAt ? Date.now() - image.startedAt : image.durationMs,
          error: message,
          failureKind: meta.failureKind,
          retryAction: meta.retryAction,
          retryable: meta.retryable,
          stage: meta.stage,
          upstreamConversationId: meta.upstreamConversationId,
          upstreamResponseId: meta.upstreamResponseId,
          imageGenerationCallId: meta.imageGenerationCallId,
          sourceAccountId: meta.sourceAccountId,
          fileIds: meta.fileIds,
          statusCode: meta.statusCode,
          lastPollStatus: meta.lastPollStatus,
          pollStatusCounts: meta.pollStatusCounts,
          pollAttempts: meta.pollAttempts,
          retryAfterMs: meta.retryAfterMs,
          upstreamBodyPreview: meta.upstreamBodyPreview,
        }
        : image,
    ),
  };
}
