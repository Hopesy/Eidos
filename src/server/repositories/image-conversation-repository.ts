import { randomUUID } from "node:crypto";

import { getDb } from "@/server/db";
import { cleanupOrphanedImageFiles, deleteImageFilesIfUnreferenced, getConversationImageReferences, normalizeConversationAssets } from "@/server/repositories/image-file-repository";
import { deleteImageUpstreamTasksByConversationIds, upsertImageUpstreamTask } from "@/server/repositories/image-upstream-task-repository";

type ImageConversationRecord = Record<string, unknown> & {
  id: string;
  title?: string;
  prompt?: string;
  model?: string;
  mode?: string;
  status?: string;
  createdAt?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function parseConversation(row: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(row.data_json || "{}"));
    return parsed && typeof parsed === "object" ? (parsed as ImageConversationRecord) : null;
  } catch {
    return null;
  }
}

function mapConversationStatusToTaskStatus(status: unknown) {
  const normalized = String(status || "").trim();
  if (normalized === "generating") return "pending" as const;
  if (normalized === "success") return "succeeded" as const;
  return "failed" as const;
}

function syncConversationUpstreamTasks(conversation: ImageConversationRecord) {
  const turns = Array.isArray(conversation.turns)
    ? conversation.turns.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [
      {
        id: `${conversation.id}-legacy`,
        mode: conversation.mode,
        prompt: conversation.prompt,
        model: conversation.model,
        status: conversation.status,
        error: conversation.error,
        failureKind: conversation.failureKind,
        retryAction: conversation.retryAction,
        retryable: conversation.retryable,
        stage: conversation.stage,
        upstreamConversationId: conversation.upstreamConversationId,
        upstreamResponseId: conversation.upstreamResponseId,
        imageGenerationCallId: conversation.imageGenerationCallId,
        sourceAccountId: conversation.sourceAccountId,
        fileIds: conversation.fileIds,
      },
    ];

  for (const turn of turns) {
    const upstreamConversationId = String(turn.upstreamConversationId || "").trim();
    const upstreamResponseId = String(turn.upstreamResponseId || "").trim();
    const imageGenerationCallId = String(turn.imageGenerationCallId || "").trim();
    const fileIds = Array.isArray(turn.fileIds) ? turn.fileIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const failureKind = String(turn.failureKind || "").trim();
    const retryAction = String(turn.retryAction || "").trim();
    const sourceAccountId = String(turn.sourceAccountId || "").trim();
    const hasSignals =
      Boolean(upstreamConversationId) ||
      Boolean(upstreamResponseId) ||
      Boolean(imageGenerationCallId) ||
      fileIds.length > 0 ||
      Boolean(failureKind) ||
      Boolean(retryAction);
    if (!hasSignals) {
      continue;
    }

    upsertImageUpstreamTask({
      localConversationId: conversation.id,
      localTurnId: String(turn.id || "").trim() || `${conversation.id}-legacy`,
      mode: (String(turn.mode || conversation.mode || "generate").trim() || "generate") as "generate" | "edit" | "upscale",
      status: mapConversationStatusToTaskStatus(turn.status),
      failureKind: failureKind || null,
      retryAction: retryAction || null,
      retryable: typeof turn.retryable === "boolean" ? turn.retryable : null,
      stage: String(turn.stage || "").trim() || null,
      upstreamConversationId: upstreamConversationId || null,
      upstreamResponseId: upstreamResponseId || null,
      imageGenerationCallId: imageGenerationCallId || null,
      sourceAccountId: sourceAccountId || null,
      fileIds,
      revisedPrompt: String(turn.prompt || conversation.prompt || "").trim() || null,
      model: String(turn.model || conversation.model || "").trim() || null,
      prompt: String(turn.prompt || conversation.prompt || "").trim() || null,
      error: String(turn.error || "").trim() || null,
    });
  }
}

export async function listImageConversationRecords() {
  const rows = getDb()
    .prepare("SELECT data_json FROM image_conversations ORDER BY created_at DESC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(parseConversation).filter((item): item is ImageConversationRecord => Boolean(item));
}

export async function getImageConversationRecord(id: string) {
  const row = getDb()
    .prepare("SELECT data_json FROM image_conversations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? parseConversation(row) : null;
}

export async function saveImageConversationRecord(input: Record<string, unknown>) {
  const withId = {
    ...input,
    id: String(input.id || randomUUID()),
  };
  const conversation = await normalizeConversationAssets(withId) as ImageConversationRecord;
  const createdAt = String(conversation.createdAt || conversation.created_at || nowIso());
  const updatedAt = nowIso();

  getDb().prepare(`
    INSERT INTO image_conversations (id, data_json, title, prompt, model, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data_json = excluded.data_json,
      title = excluded.title,
      prompt = excluded.prompt,
      model = excluded.model,
      mode = excluded.mode,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    conversation.id,
    JSON.stringify(conversation),
    String(conversation.title || ""),
    String(conversation.prompt || ""),
    String(conversation.model || ""),
    String(conversation.mode || "generate"),
    String(conversation.status || "success"),
    createdAt,
    updatedAt,
  );

  syncConversationUpstreamTasks(conversation);

  return conversation;
}

export async function deleteImageConversationRecord(id: string) {
  const refs = getConversationImageReferences(id);
  const imageIds = refs.map((item) => item.imageId);
  getDb().prepare("DELETE FROM image_conversations WHERE id = ?").run(id);
  deleteImageUpstreamTasksByConversationIds([id]);
  const cleanup = await deleteImageFilesIfUnreferenced(imageIds, [id]);
  return {
    deletedConversationId: id,
    referencedImageIds: imageIds,
    ...cleanup,
  };
}

export async function clearImageConversationRecords() {
  const conversations = await listImageConversationRecords();
  const imageIds = conversations.flatMap((conversation) => {
    try {
      return getConversationImageReferences(String(conversation.id || "")).map((item) => item.imageId);
    } catch {
      return [] as string[];
    }
  });
  getDb().prepare("DELETE FROM image_conversations").run();
  deleteImageUpstreamTasksByConversationIds(conversations.map((conversation) => String(conversation.id || "")));
  const cleanup = await deleteImageFilesIfUnreferenced(imageIds);
  const orphanCleanup = await cleanupOrphanedImageFiles();
  return {
    clearedConversations: conversations.length,
    referencedImageIds: [...new Set(imageIds)],
    deletedImageIds: [...new Set([...(cleanup.deletedImageIds || []), ...(orphanCleanup.deletedImageIds || [])])],
    missingImageIds: [...new Set([...(cleanup.missingImageIds || []), ...(orphanCleanup.missingImageIds || [])])],
  };
}
