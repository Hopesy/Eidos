import { randomUUID } from "node:crypto";

import type { GalleryImageItem } from "@/lib/api/types";
import { getDb } from "@/server/db";
import { getImageFile } from "@/server/repositories/image/file-repository";
import { ApiError } from "@/server/response";

export type { GalleryImageItem } from "@/lib/api/types";

type FavoriteRow = {
  id: string;
  image_id: string;
  conversation_id: string;
  turn_id: string;
  image_local_id: string;
  note?: string | null;
  created_at: string;
};

type ConversationRecord = Record<string, unknown> & {
  id?: string;
  title?: string;
  prompt?: string;
  model?: string;
  mode?: string;
  imageRatio?: string;
  imageSize?: string;
  imageQuality?: string;
  imageFormat?: string;
  count?: number;
  createdAt?: string;
  turns?: unknown[];
};

type TurnRecord = Record<string, unknown> & {
  id?: string;
  title?: string;
  prompt?: string;
  model?: string;
  mode?: string;
  imageRatio?: string;
  imageSize?: string;
  imageQuality?: string;
  imageFormat?: string;
  count?: number;
  createdAt?: string;
  durationMs?: number;
  images?: unknown[];
};

type ImageRecord = Record<string, unknown> & {
  id?: string;
  status?: string;
  url?: string;
  b64_json?: string;
  image_id?: string;
  revised_prompt?: string;
  durationMs?: number;
  sourceAccountId?: string;
  source_account_id?: string;
};

export type ImageFavoriteInput = {
  conversationId: string;
  turnId: string;
  imageLocalId: string;
  imageId?: string;
  note?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function parseConversation(value: unknown): ConversationRecord | null {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? (parsed as ConversationRecord) : null;
  } catch {
    return null;
  }
}

function normalizeMode(value: unknown): GalleryImageItem["mode"] {
  const normalized = cleanString(value);
  if (normalized === "edit" || normalized === "upscale") {
    return normalized;
  }
  return "generate";
}

function normalizeModel(value: unknown): GalleryImageItem["model"] {
  return cleanString(value) || "gpt-image-2";
}

function normalizeRatio(value: unknown): GalleryImageItem["imageRatio"] | undefined {
  const normalized = cleanString(value);
  if (
    normalized === "auto" ||
    normalized === "1:1" ||
    normalized === "3:2" ||
    normalized === "2:3" ||
    normalized === "16:9" ||
    normalized === "9:16"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeQuality(value: unknown): GalleryImageItem["imageQuality"] | undefined {
  const normalized = cleanString(value);
  if (normalized === "auto" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return undefined;
}

function normalizeFormat(value: unknown): GalleryImageItem["imageFormat"] | undefined {
  const normalized = cleanString(value);
  if (normalized === "png" || normalized === "jpeg" || normalized === "webp") {
    return normalized;
  }
  return undefined;
}

function normalizeSize(value: unknown): GalleryImageItem["imageSize"] | undefined {
  const normalized = cleanString(value);
  if (
    normalized === "auto" ||
    normalized === "1024x1024" ||
    normalized === "1536x1024" ||
    normalized === "1024x1536" ||
    normalized === "256x256" ||
    normalized === "512x512" ||
    normalized === "1792x1024" ||
    normalized === "1024x1792" ||
    normalized === "1920x1088" ||
    normalized === "2048x2048" ||
    normalized === "3072x2048" ||
    normalized === "2048x3072" ||
    normalized === "2560x1440" ||
    normalized === "2880x2880" ||
    normalized === "3520x2336" ||
    normalized === "2336x3520" ||
    normalized === "3840x2160" ||
    normalized === "1088x1920" ||
    normalized === "1440x2560" ||
    normalized === "2160x3840"
  ) {
    return normalized;
  }
  return undefined;
}

function buildLegacyTurn(conversation: ConversationRecord): TurnRecord {
  return {
    id: `${cleanString(conversation.id)}-legacy`,
    title: conversation.title,
    prompt: conversation.prompt,
    model: conversation.model,
    mode: conversation.mode,
    imageRatio: conversation.imageRatio,
    imageSize: conversation.imageSize,
    imageQuality: conversation.imageQuality,
    imageFormat: conversation.imageFormat,
    count: conversation.count,
    createdAt: conversation.createdAt,
    images: Array.isArray(conversation.images) ? conversation.images : [],
  };
}

function listConversationTurns(conversation: ConversationRecord) {
  if (Array.isArray(conversation.turns) && conversation.turns.length > 0) {
    return conversation.turns.filter((item): item is TurnRecord => Boolean(item) && typeof item === "object");
  }
  return [buildLegacyTurn(conversation)];
}

function findFavoriteTarget(conversation: ConversationRecord, turnId: string, imageLocalId: string) {
  const turn = listConversationTurns(conversation).find((item) => cleanString(item.id) === turnId);
  if (!turn) {
    return null;
  }
  const images = Array.isArray(turn.images)
    ? turn.images.filter((item): item is ImageRecord => Boolean(item) && typeof item === "object")
    : [];
  const image = images.find((item) => cleanString(item.id) === imageLocalId);
  return image ? { turn, image } : null;
}

function getConversation(conversationId: string) {
  const row = getDb()
    .prepare("SELECT data_json FROM image_conversations WHERE id = ?")
    .get(conversationId) as Record<string, unknown> | undefined;
  return row ? parseConversation(row.data_json) : null;
}

function resolveImageId(image: ImageRecord, preferredImageId?: string) {
  const explicitImageId = cleanString(image.image_id);
  const preferred = cleanString(preferredImageId);
  if (explicitImageId) {
    return explicitImageId;
  }
  if (preferred) {
    return preferred;
  }

  const url = cleanString(image.url);
  const match = /^\/api\/images\/([^/?#]+)$/.exec(url);
  return match ? decodeURIComponent(match[1]) : "";
}

function buildImageUrl(image: ImageRecord, imageId: string) {
  const url = cleanString(image.url);
  if (url) {
    return url;
  }
  const file = imageId ? getImageFile(imageId) : null;
  if (file?.public_path) {
    return file.public_path;
  }
  if (imageId) {
    return `/api/images/${encodeURIComponent(imageId)}`;
  }
  const b64 = cleanString(image.b64_json);
  return b64 ? `data:image/png;base64,${b64}` : "";
}

function buildGalleryItem(row: FavoriteRow): GalleryImageItem | null {
  const conversation = getConversation(row.conversation_id);
  if (!conversation) {
    return null;
  }

  const target = findFavoriteTarget(conversation, row.turn_id, row.image_local_id);
  if (!target) {
    return null;
  }

  const imageId = resolveImageId(target.image, row.image_id);
  if (!imageId || (row.image_id && row.image_id !== imageId)) {
    return null;
  }

  const imageUrl = buildImageUrl(target.image, imageId);
  if (!imageUrl) {
    return null;
  }

  return {
    favoriteId: row.id,
    imageId,
    imageLocalId: row.image_local_id,
    imageUrl,
    createdAt: row.created_at,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    title: cleanString(target.turn.title) || cleanString(conversation.title) || "未命名图片",
    mode: normalizeMode(target.turn.mode ?? conversation.mode),
    prompt: cleanString(target.turn.prompt ?? conversation.prompt),
    revisedPrompt: cleanString(target.image.revised_prompt) || undefined,
    model: normalizeModel(target.turn.model ?? conversation.model),
    imageRatio: normalizeRatio(target.turn.imageRatio ?? conversation.imageRatio),
    imageSize: normalizeSize(target.turn.imageSize ?? conversation.imageSize),
    imageQuality: normalizeQuality(target.turn.imageQuality ?? conversation.imageQuality),
    imageFormat: normalizeFormat(target.turn.imageFormat ?? conversation.imageFormat),
    count: Math.max(1, Number(target.turn.count ?? conversation.count ?? 1) || 1),
    durationMs: Number.isFinite(Number(target.image.durationMs ?? target.turn.durationMs))
      ? Number(target.image.durationMs ?? target.turn.durationMs)
      : undefined,
    sourceAccountId: cleanString(target.image.sourceAccountId ?? target.image.source_account_id) || undefined,
    note: row.note ?? null,
  };
}

function getFavoriteRowById(id: string) {
  return getDb()
    .prepare(`
      SELECT id, image_id, conversation_id, turn_id, image_local_id, note, created_at
      FROM image_favorites
      WHERE id = ?
    `)
    .get(id) as FavoriteRow | undefined;
}

export function listImageFavorites() {
  const rows = getDb()
    .prepare(`
      SELECT id, image_id, conversation_id, turn_id, image_local_id, note, created_at
      FROM image_favorites
      ORDER BY created_at DESC
    `)
    .all() as FavoriteRow[];

  return rows.map(buildGalleryItem).filter((item): item is GalleryImageItem => Boolean(item));
}

export function getImageFavorite(id: string) {
  const row = getFavoriteRowById(id);
  return row ? buildGalleryItem(row) : null;
}

export function addImageFavorite(input: ImageFavoriteInput) {
  const conversationId = cleanString(input.conversationId);
  const turnId = cleanString(input.turnId);
  const imageLocalId = cleanString(input.imageLocalId);
  if (!conversationId || !turnId || !imageLocalId) {
    throw new ApiError(400, "favorite target is required");
  }

  const conversation = getConversation(conversationId);
  if (!conversation) {
    throw new ApiError(404, "conversation not found");
  }

  const target = findFavoriteTarget(conversation, turnId, imageLocalId);
  if (!target) {
    throw new ApiError(404, "image result not found");
  }

  const imageId = resolveImageId(target.image, input.imageId);
  if (!imageId) {
    throw new ApiError(400, "image result is not persisted");
  }

  const preferredImageId = cleanString(input.imageId);
  const existingImageId = cleanString(target.image.image_id);
  if (preferredImageId && existingImageId && preferredImageId !== existingImageId) {
    throw new ApiError(409, "favorite image id does not match conversation image");
  }

  getDb()
    .prepare(`
      INSERT INTO image_favorites (
        id, image_id, conversation_id, turn_id, image_local_id, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, turn_id, image_local_id) DO UPDATE SET
        image_id = excluded.image_id,
        note = COALESCE(excluded.note, image_favorites.note)
    `)
    .run(
      randomUUID(),
      imageId,
      conversationId,
      turnId,
      imageLocalId,
      cleanString(input.note) || null,
      nowIso(),
    );

  const row = getDb()
    .prepare(`
      SELECT id, image_id, conversation_id, turn_id, image_local_id, note, created_at
      FROM image_favorites
      WHERE conversation_id = ? AND turn_id = ? AND image_local_id = ?
    `)
    .get(conversationId, turnId, imageLocalId) as FavoriteRow | undefined;

  const item = row ? buildGalleryItem(row) : null;
  if (!item) {
    throw new ApiError(500, "failed to create favorite");
  }
  return item;
}

export function deleteImageFavorite(id: string) {
  const result = getDb()
    .prepare("DELETE FROM image_favorites WHERE id = ?")
    .run(id) as { changes?: number | bigint };
  return {
    deletedFavoriteId: id,
    deleted: Number(result.changes || 0) > 0,
  };
}

export function deleteImageFavoritesByConversationIds(conversationIds: string[]) {
  const ids = [...new Set(conversationIds.map(cleanString).filter(Boolean))];
  if (ids.length === 0) {
    return 0;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`DELETE FROM image_favorites WHERE conversation_id IN (${placeholders})`)
    .run(...ids) as { changes?: number | bigint };
  return Number(result.changes || 0);
}
