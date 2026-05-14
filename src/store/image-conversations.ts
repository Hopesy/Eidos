"use client";

import localforage from "localforage";

import type { ImageGenerationQuality, ImageGenerationSize, ImageModel, ImageOutputFormat } from "@/lib/api";
import type { ImageRatioOption } from "@/shared/image-generation";
import { normalizeImageOutputFormat, resolveImageRatioFromSize } from "@/shared/image-generation";
import { httpRequest } from "@/lib/request";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ImageMode = "generate" | "edit" | "upscale";

export type StoredSourceImage = {
  id: string;
  role: "image" | "mask";
  name: string;
  dataUrl: string;
  /** 自动继承上下文时设为 true，渲染时隐藏，不向用户展示 */
  hiddenInConversation?: boolean;
  image_id?: string;
  file_path?: string;
  file_id?: string;
  gen_id?: string;
  response_id?: string;
  image_generation_call_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

export type StoredImage = {
  id: string;
  status?: "loading" | "success" | "error";
  b64_json?: string;
  url?: string;
  startedAt?: number;
  durationMs?: number;
  image_id?: string;
  file_path?: string;
  revised_prompt?: string;
  error?: string;
  text?: string;
  // Extended fields for multi-turn / edit / upscale support
  file_id?: string;
  gen_id?: string;
  response_id?: string;
  image_generation_call_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
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

export type ImageConversationStatus = "generating" | "success" | "error";

export type ImageConversationTurn = {
  id: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  imageRatio?: ImageRatioOption;
  imageSize?: ImageGenerationSize;
  imageQuality?: ImageGenerationQuality;
  imageFormat?: ImageOutputFormat;
  count: number;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: ImageConversationStatus;
  error?: string;
  durationMs?: number;
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

export type ImageConversation = {
  id: string;
  title: string;
  prompt: string;
  model: ImageModel;
  imageRatio?: ImageRatioOption;
  imageSize?: ImageGenerationSize;
  imageQuality?: ImageGenerationQuality;
  imageFormat?: ImageOutputFormat;
  count: number;
  images: StoredImage[];
  createdAt: string;
  status: ImageConversationStatus;
  error?: string;
  // Multi-mode / multi-turn extensions
  mode: ImageMode;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  turns?: ImageConversationTurn[];
};

// ─────────────────────────────────────────────
// Server-backed persistence
// ─────────────────────────────────────────────


const legacyImageConversationStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "image_conversations",
});

const IMAGE_CONVERSATIONS_KEY = "items";
let cachedConversations: ImageConversation[] | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

function sortConversations(items: ImageConversation[]): ImageConversation[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function migrateLegacyLocalHistoryIfNeeded(serverItems: ImageConversation[]): Promise<ImageConversation[] | null> {
  if (serverItems.length > 0) return null;
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = (async () => {
      const legacyItems = await legacyImageConversationStorage.getItem<ImageConversation[]>(IMAGE_CONVERSATIONS_KEY);
      const normalized = sortConversations((legacyItems || []).map(normalizeConversation));
      if (normalized.length === 0) return;
      for (const item of normalized) {
        await httpRequest<{ item: ImageConversation }>("/api/image-conversations", {
          method: "POST",
          body: item,
        });
      }
      await legacyImageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
    })();
  }
  await legacyMigrationPromise;
  const migrated = await httpRequest<{ items: ImageConversation[] }>("/api/image-conversations");
  return sortConversations((migrated.items || []).map(normalizeConversation));
}

async function fetchConversations(): Promise<ImageConversation[]> {
  const response = await httpRequest<{ items: ImageConversation[] }>("/api/image-conversations");
  const items = sortConversations((response.items || []).map(normalizeConversation));
  const migrated = await migrateLegacyLocalHistoryIfNeeded(items);
  cachedConversations = migrated ?? items;
  return cachedConversations;
}

// ─────────────────────────────────────────────
// Normalize helpers
// ─────────────────────────────────────────────

export function normalizeStoredImage(image: StoredImage): StoredImage {
  if (
    image.status === "loading" ||
    image.status === "error" ||
    image.status === "success"
  ) {
    return image;
  }
  return {
    ...image,
    status: image.b64_json || image.url ? "success" : "loading",
  };
}

export function normalizeTurn(turn: ImageConversationTurn): ImageConversationTurn {
  return {
    ...turn,
    mode: turn.mode ?? "generate",
    imageRatio: turn.imageRatio ?? resolveImageRatioFromSize(turn.imageSize),
    imageSize: turn.imageSize ?? "auto",
    imageQuality: turn.imageQuality ?? "auto",
    imageFormat: normalizeImageOutputFormat(turn.imageFormat),
    sourceImages: turn.sourceImages ?? [],
    images: (turn.images || []).map(normalizeStoredImage),
  };
}

function deriveConversationStatus(
  turns: ImageConversationTurn[],
  fallback: ImageConversationStatus,
): ImageConversationStatus {
  if (turns.some((turn) => turn.status === "generating" || turn.images.some((image) => image.status === "loading"))) {
    return "generating";
  }
  if (turns.some((turn) => turn.status === "error" || turn.images.some((image) => image.status === "error"))) {
    return "error";
  }
  if (turns.length > 0 && turns.every((turn) => turn.status === "success")) {
    return "success";
  }
  return fallback;
}

function deriveConversationError(
  turns: ImageConversationTurn[],
  status: ImageConversationStatus,
  fallback?: string,
) {
  if (status !== "error") {
    return undefined;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status === "error" && turn.error) {
      return turn.error;
    }
  }
  return fallback;
}

export function normalizeConversation(
  conversation: ImageConversation,
): ImageConversation {
  const hasTurns =
    Array.isArray(conversation.turns) && conversation.turns.length > 0;

  const legacyTurn: ImageConversationTurn | null = !hasTurns
    ? normalizeTurn({
      id: `${conversation.id}-legacy`,
      title: conversation.title,
      mode: conversation.mode ?? "generate",
      prompt: conversation.prompt,
      model: conversation.model,
      imageRatio: conversation.imageRatio,
      imageSize: conversation.imageSize,
      imageQuality: conversation.imageQuality,
      imageFormat: conversation.imageFormat,
      count: conversation.count,
      scale: conversation.scale,
      sourceImages: conversation.sourceImages ?? [],
      images: conversation.images || [],
      createdAt: conversation.createdAt,
      status: conversation.status,
      error: conversation.error,
    })
    : null;
  const turns = hasTurns
    ? conversation.turns!.map(normalizeTurn)
    : legacyTurn
      ? [legacyTurn]
      : [];
  const status = deriveConversationStatus(turns, conversation.status ?? "success");

  return {
    ...conversation,
    mode: conversation.mode ?? "generate",
    imageRatio: conversation.imageRatio ?? resolveImageRatioFromSize(conversation.imageSize),
    imageSize: conversation.imageSize ?? "auto",
    imageQuality: conversation.imageQuality ?? "auto",
    imageFormat: normalizeImageOutputFormat(conversation.imageFormat),
    sourceImages: conversation.sourceImages ?? [],
    images: (conversation.images || []).map(normalizeStoredImage),
    status,
    error: deriveConversationError(turns, status, conversation.error),
    turns,
  };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function listImageConversations(): Promise<ImageConversation[]> {
  if (cachedConversations !== null) return cachedConversations;
  return fetchConversations();
}

export function primeImageConversations(items: ImageConversation[]): void {
  cachedConversations = sortConversations((items || []).map(normalizeConversation));
}

export async function getImageConversation(
  id: string,
): Promise<ImageConversation | null> {
  try {
    const response = await httpRequest<{ item: ImageConversation }>(`/api/image-conversations/${encodeURIComponent(id)}`);
    return normalizeConversation(response.item);
  } catch {
    const items = await listImageConversations();
    return items.find((item) => item.id === id) ?? null;
  }
}

export async function saveImageConversation(
  conversation: ImageConversation,
): Promise<void> {
  const normalized = normalizeConversation(conversation);
  const response = await httpRequest<{ item: ImageConversation }>("/api/image-conversations", {
    method: "POST",
    body: normalized,
  });
  const saved = normalizeConversation(response.item);
  const items = cachedConversations ?? [];
  cachedConversations = sortConversations([saved, ...items.filter((item) => item.id !== saved.id)]);
}

export async function updateImageConversation(
  id: string,
  updater: (prev: ImageConversation) => ImageConversation,
): Promise<ImageConversation> {
  const existing = await getImageConversation(id);
  const base: ImageConversation = existing ?? {
    id,
    title: "",
    mode: "generate",
    prompt: "",
    model: "gpt-image-1",
    imageRatio: "auto",
    imageSize: "auto",
    imageQuality: "auto",
    imageFormat: "png",
    count: 1,
    scale: undefined,
    sourceImages: [],
    images: [],
    turns: [],
    createdAt: new Date().toISOString(),
    status: "generating",
  };

  const updated = normalizeConversation(updater(base));
  const response = await httpRequest<{ item: ImageConversation }>(`/api/image-conversations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: updated,
  });
  const saved = normalizeConversation(response.item);
  const items = cachedConversations ?? [];
  cachedConversations = sortConversations([saved, ...items.filter((item) => item.id !== id)]);
  return saved;
}

export async function deleteImageConversation(id: string): Promise<void> {
  await httpRequest(`/api/image-conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  const items = cachedConversations ?? [];
  cachedConversations = items.filter((item) => item.id !== id);
}

export async function clearImageConversations(): Promise<void> {
  await httpRequest("/api/image-conversations", { method: "DELETE" });
  cachedConversations = [];
  await legacyImageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
}

