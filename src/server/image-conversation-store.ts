import { randomUUID } from "node:crypto";

import { getDb } from "@/server/db";
import { cleanupOrphanedImageFiles, deleteImageFilesIfUnreferenced, getConversationImageReferences, normalizeConversationAssets } from "@/server/image-file-store";

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

  return conversation;
}

export async function deleteImageConversationRecord(id: string) {
  const refs = getConversationImageReferences(id);
  const imageIds = refs.map((item) => item.imageId);
  getDb().prepare("DELETE FROM image_conversations WHERE id = ?").run(id);
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
  const cleanup = await deleteImageFilesIfUnreferenced(imageIds);
  const orphanCleanup = await cleanupOrphanedImageFiles();
  return {
    clearedConversations: conversations.length,
    referencedImageIds: [...new Set(imageIds)],
    deletedImageIds: [...new Set([...(cleanup.deletedImageIds || []), ...(orphanCleanup.deletedImageIds || [])])],
    missingImageIds: [...new Set([...(cleanup.missingImageIds || []), ...(orphanCleanup.missingImageIds || [])])],
  };
}
