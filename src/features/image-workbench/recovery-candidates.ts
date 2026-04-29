import type { RecoverableImageTaskItem, ImageModel } from "@/lib/api";
import type { ImageConversation, ImageConversationTurn } from "@/store/image-conversations";

export function findRecoverableTurn(conversations: ImageConversation[]) {
  return conversations
    .flatMap((conversation) =>
      (conversation.turns ?? []).map((turn) => ({
        conversationId: conversation.id,
        turn,
      })),
    )
    .filter(({ turn }) =>
      turn.status === "error" &&
      Boolean(turn.retryable) &&
      Boolean(turn.upstreamConversationId) &&
      (turn.retryAction === "resume_polling" || turn.retryAction === "retry_download"),
    )
    .sort((a, b) => b.turn.createdAt.localeCompare(a.turn.createdAt))[0] ?? null;
}

export function findRecoverableTaskCandidate(tasks: RecoverableImageTaskItem[], conversations: ImageConversation[]) {
  const byConversation = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const sortedTasks = [...tasks].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  for (const task of sortedTasks) {
    const conversationId = String(task.localConversationId || "").trim();
    const turnId = String(task.localTurnId || "").trim();
    if (!conversationId || !turnId) {
      continue;
    }
    const conversation = byConversation.get(conversationId);
    if (!conversation) {
      continue;
    }
    const turn = (conversation.turns ?? []).find((item) => item.id === turnId);
    if (!turn || turn.status !== "error") {
      continue;
    }
    const mergedTurn: ImageConversationTurn = {
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
    return {
      task,
      conversationId,
      turn: mergedTurn,
    };
  }

  return null;
}
