import type { RecoverableImageTaskItem, ImageModel } from "@/lib/api";
import type { ImageConversationTurn } from "@/store/image-conversations";

export function mergeRecoverableTaskIntoTurn(
  turn: ImageConversationTurn,
  task: RecoverableImageTaskItem,
): ImageConversationTurn {
  return {
    ...turn,
    mode: task.mode || turn.mode,
    prompt: String(task.prompt || task.revisedPrompt || turn.prompt || ""),
    model: (String(task.model || turn.model || "gpt-image-1") || "gpt-image-1") as ImageModel,
    failureKind: String(task.failureKind || turn.failureKind || "").trim() || turn.failureKind,
    retryAction: String(task.retryAction || turn.retryAction || "").trim() || turn.retryAction,
    retryable: typeof task.retryable === "boolean" ? task.retryable : turn.retryable,
    stage: String(task.stage || turn.stage || "").trim() || turn.stage,
    upstreamConversationId:
      String(task.upstreamConversationId || turn.upstreamConversationId || "").trim() || turn.upstreamConversationId,
    upstreamResponseId:
      String(task.upstreamResponseId || turn.upstreamResponseId || "").trim() || turn.upstreamResponseId,
    imageGenerationCallId:
      String(task.imageGenerationCallId || turn.imageGenerationCallId || "").trim() || turn.imageGenerationCallId,
    sourceAccountId:
      String(task.sourceAccountId || turn.sourceAccountId || "").trim() || turn.sourceAccountId,
    fileIds: Array.isArray(task.fileIds) && task.fileIds.length > 0 ? task.fileIds : turn.fileIds,
    error: String(task.error || turn.error || "").trim() || turn.error,
  };
}

export function findRecoverableTaskForTurn(
  tasks: RecoverableImageTaskItem[],
  conversationId: string,
  turn: ImageConversationTurn,
) {
  const turnId = String(turn.id || "").trim();
  if (!conversationId || !turnId) {
    return null;
  }

  return tasks.find((task) =>
    String(task.localConversationId || "").trim() === conversationId &&
      String(task.localTurnId || "").trim() === turnId,
  ) ?? null;
}
