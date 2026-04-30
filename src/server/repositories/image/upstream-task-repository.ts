import { randomUUID } from "node:crypto";

import { getDb } from "@/server/db";

export type ImageUpstreamTaskStatus = "pending" | "succeeded" | "failed";

export type ImageUpstreamTaskRecord = {
  id: string;
  localConversationId?: string | null;
  localTurnId?: string | null;
  mode: "generate" | "edit" | "upscale";
  status: ImageUpstreamTaskStatus;
  failureKind?: string | null;
  retryAction?: string | null;
  retryable?: boolean | null;
  stage?: string | null;
  upstreamConversationId?: string | null;
  upstreamResponseId?: string | null;
  imageGenerationCallId?: string | null;
  sourceAccountId?: string | null;
  fileIds?: string[];
  revisedPrompt?: string | null;
  model?: string | null;
  prompt?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpsertImageUpstreamTaskInput = Partial<ImageUpstreamTaskRecord> & {
  mode: ImageUpstreamTaskRecord["mode"];
  status: ImageUpstreamTaskStatus;
};

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeFileIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function parseTask(row: Record<string, unknown> | undefined): ImageUpstreamTaskRecord | null {
  if (!row) return null;
  try {
    const parsed = JSON.parse(String(row.data_json || "{}")) as ImageUpstreamTaskRecord;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...parsed,
      id: String(parsed.id || row.id || ""),
      mode: (parsed.mode || row.mode || "generate") as ImageUpstreamTaskRecord["mode"],
      status: (parsed.status || row.status || "pending") as ImageUpstreamTaskStatus,
      fileIds: normalizeFileIds(parsed.fileIds),
      createdAt: String(parsed.createdAt || row.created_at || nowIso()),
      updatedAt: String(parsed.updatedAt || row.updated_at || nowIso()),
    };
  } catch {
    return null;
  }
}

export function upsertImageUpstreamTask(input: UpsertImageUpstreamTaskInput) {
  const db = getDb();
  const existing = input.id
    ? getImageUpstreamTask(input.id)
    : input.localConversationId && input.localTurnId
      ? getImageUpstreamTaskByLocalTurn(input.localConversationId, input.localTurnId)
      : null;
  const ts = nowIso();
  const id = cleanString(input.id) || existing?.id || randomUUID();
  const createdAt = existing?.createdAt || cleanString(input.createdAt) || ts;
  const record: ImageUpstreamTaskRecord = {
    ...(existing || {}),
    ...input,
    id,
    localConversationId: cleanString(input.localConversationId ?? existing?.localConversationId),
    localTurnId: cleanString(input.localTurnId ?? existing?.localTurnId),
    mode: input.mode,
    status: input.status,
    failureKind: cleanString(input.failureKind ?? existing?.failureKind),
    retryAction: cleanString(input.retryAction ?? existing?.retryAction),
    retryable: typeof input.retryable === "boolean" ? input.retryable : existing?.retryable,
    stage: cleanString(input.stage ?? existing?.stage),
    upstreamConversationId: cleanString(input.upstreamConversationId ?? existing?.upstreamConversationId),
    upstreamResponseId: cleanString(input.upstreamResponseId ?? existing?.upstreamResponseId),
    imageGenerationCallId: cleanString(input.imageGenerationCallId ?? existing?.imageGenerationCallId),
    sourceAccountId: cleanString(input.sourceAccountId ?? existing?.sourceAccountId),
    fileIds: normalizeFileIds(input.fileIds ?? existing?.fileIds),
    revisedPrompt: cleanString(input.revisedPrompt ?? existing?.revisedPrompt),
    model: cleanString(input.model ?? existing?.model),
    prompt: cleanString(input.prompt ?? existing?.prompt),
    error: cleanString(input.error ?? existing?.error),
    createdAt,
    updatedAt: ts,
  };

  db.prepare(`
    INSERT INTO image_upstream_tasks (
      id, data_json, local_conversation_id, local_turn_id, mode, status,
      failure_kind, retry_action, upstream_conversation_id, upstream_response_id,
      image_generation_call_id, source_account_id, file_ids_json, revised_prompt,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data_json = excluded.data_json,
      local_conversation_id = excluded.local_conversation_id,
      local_turn_id = excluded.local_turn_id,
      mode = excluded.mode,
      status = excluded.status,
      failure_kind = excluded.failure_kind,
      retry_action = excluded.retry_action,
      upstream_conversation_id = excluded.upstream_conversation_id,
      upstream_response_id = excluded.upstream_response_id,
      image_generation_call_id = excluded.image_generation_call_id,
      source_account_id = excluded.source_account_id,
      file_ids_json = excluded.file_ids_json,
      revised_prompt = excluded.revised_prompt,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    JSON.stringify(record),
    record.localConversationId ?? null,
    record.localTurnId ?? null,
    record.mode,
    record.status,
    record.failureKind ?? null,
    record.retryAction ?? null,
    record.upstreamConversationId ?? null,
    record.upstreamResponseId ?? null,
    record.imageGenerationCallId ?? null,
    record.sourceAccountId ?? null,
    JSON.stringify(record.fileIds || []),
    record.revisedPrompt ?? null,
    createdAt,
    record.updatedAt,
  );

  return record;
}

export function getImageUpstreamTask(id: string) {
  const normalized = cleanString(id);
  if (!normalized) return null;
  const row = getDb().prepare("SELECT * FROM image_upstream_tasks WHERE id = ?").get(normalized) as Record<string, unknown> | undefined;
  return parseTask(row);
}

export function getImageUpstreamTaskByLocalTurn(localConversationId: string, localTurnId: string) {
  const conversationId = cleanString(localConversationId);
  const turnId = cleanString(localTurnId);
  if (!conversationId || !turnId) return null;
  const row = getDb()
    .prepare("SELECT * FROM image_upstream_tasks WHERE local_conversation_id = ? AND local_turn_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(conversationId, turnId) as Record<string, unknown> | undefined;
  return parseTask(row);
}

export function listRecoverableImageUpstreamTasks(limit = 20) {
  const rows = getDb()
    .prepare(`
      SELECT * FROM image_upstream_tasks
      WHERE status = 'failed'
        AND retry_action IN ('resume_polling', 'retry_download')
        AND (upstream_conversation_id IS NOT NULL OR upstream_response_id IS NOT NULL)
      ORDER BY updated_at DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  return rows.map(parseTask).filter((item): item is ImageUpstreamTaskRecord => Boolean(item));
}

export function deleteImageUpstreamTasksByConversationIds(conversationIds: string[]) {
  const ids = [...new Set(conversationIds.map((item) => cleanString(item)).filter(Boolean))] as string[];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`DELETE FROM image_upstream_tasks WHERE local_conversation_id IN (${placeholders})`)
    .run(...ids) as { changes?: number };
  return Number(result?.changes ?? 0);
}
