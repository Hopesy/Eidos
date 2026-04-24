"use client";

import localforage from "localforage";

import type { ImageModel } from "@/lib/api";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ImageMode = "generate" | "edit" | "upscale";

export type StoredSourceImage = {
  id: string;
  role: "image" | "mask";
  name: string;
  dataUrl: string;
};

export type StoredImage = {
  id: string;
  status?: "loading" | "success" | "error";
  b64_json?: string;
  error?: string;
  // Extended fields for multi-turn / edit / upscale support
  file_id?: string;
  gen_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

export type ImageConversationStatus = "generating" | "success" | "error";

export type ImageConversationTurn = {
  id: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  count: number;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: ImageConversationStatus;
  error?: string;
};

export type ImageConversation = {
  id: string;
  title: string;
  prompt: string;
  model: ImageModel;
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
// Storage instance
// ─────────────────────────────────────────────

const imageConversationStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "image_conversations",
});

const IMAGE_CONVERSATIONS_KEY = "items";

// ─────────────────────────────────────────────
// In-memory cache
// ─────────────────────────────────────────────

let cachedConversations: ImageConversation[] | null = null;
let loadPromise: Promise<ImageConversation[]> | null = null;

/** Pending write: the latest list that should be flushed to storage. */
let writeQueue: ImageConversation[] | null = null;
let writePending = false;

async function flushWriteQueue(): Promise<void> {
  if (writePending) return;
  writePending = true;
  // Yield to allow multiple synchronous callers to coalesce.
  await Promise.resolve();
  const snapshot = writeQueue;
  writeQueue = null;
  writePending = false;
  if (snapshot !== null) {
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, snapshot);
    cachedConversations = snapshot;
  }
}

function scheduleWrite(items: ImageConversation[]): void {
  writeQueue = items;
  flushWriteQueue();
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
    status: image.b64_json ? "success" : "loading",
  };
}

export function normalizeTurn(turn: ImageConversationTurn): ImageConversationTurn {
  return {
    ...turn,
    mode: turn.mode ?? "generate",
    sourceImages: turn.sourceImages ?? [],
    images: (turn.images || []).map(normalizeStoredImage),
  };
}

export function normalizeConversation(
  conversation: ImageConversation,
): ImageConversation {
  const hasTurns =
    Array.isArray(conversation.turns) && conversation.turns.length > 0;

  // Build a legacy turn from root fields when there are no turns yet.
  const legacyTurn: ImageConversationTurn | null = !hasTurns
    ? normalizeTurn({
      id: `${conversation.id}-legacy`,
      title: conversation.title,
      mode: conversation.mode ?? "generate",
      prompt: conversation.prompt,
      model: conversation.model,
      count: conversation.count,
      scale: conversation.scale,
      sourceImages: conversation.sourceImages ?? [],
      images: conversation.images || [],
      createdAt: conversation.createdAt,
      status: conversation.status,
      error: conversation.error,
    })
    : null;

  return {
    ...conversation,
    mode: conversation.mode ?? "generate",
    sourceImages: conversation.sourceImages ?? [],
    images: (conversation.images || []).map(normalizeStoredImage),
    turns: hasTurns
      ? conversation.turns!.map(normalizeTurn)
      : legacyTurn
        ? [legacyTurn]
        : [],
  };
}

function sortConversations(items: ImageConversation[]): ImageConversation[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─────────────────────────────────────────────
// Core load (with cache)
// ─────────────────────────────────────────────

async function loadConversations(): Promise<ImageConversation[]> {
  if (cachedConversations !== null) return cachedConversations;

  if (!loadPromise) {
    loadPromise = imageConversationStorage
      .getItem<ImageConversation[]>(IMAGE_CONVERSATIONS_KEY)
      .then((raw) => {
        const items = sortConversations(
          (raw || []).map(normalizeConversation),
        );
        cachedConversations = items;
        loadPromise = null;
        return items;
      });
  }

  return loadPromise;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function listImageConversations(): Promise<ImageConversation[]> {
  return loadConversations();
}

export async function getImageConversation(
  id: string,
): Promise<ImageConversation | null> {
  const items = await loadConversations();
  return items.find((item) => item.id === id) ?? null;
}

export async function saveImageConversation(
  conversation: ImageConversation,
): Promise<void> {
  const items = await loadConversations();
  const normalized = normalizeConversation(conversation);
  const next = sortConversations([
    normalized,
    ...items.filter((item) => item.id !== conversation.id),
  ]);
  cachedConversations = next;
  scheduleWrite(next);
}

export async function updateImageConversation(
  id: string,
  updater: (prev: ImageConversation) => ImageConversation,
): Promise<ImageConversation> {
  const items = await loadConversations();
  const existing = items.find((item) => item.id === id);
  if (!existing) {
    throw new Error(`ImageConversation not found: ${id}`);
  }
  const updated = normalizeConversation(updater(existing));
  const next = sortConversations([
    updated,
    ...items.filter((item) => item.id !== id),
  ]);
  cachedConversations = next;
  scheduleWrite(next);
  return updated;
}

export async function deleteImageConversation(id: string): Promise<void> {
  const items = await loadConversations();
  const next = items.filter((item) => item.id !== id);
  cachedConversations = next;
  scheduleWrite(next);
}

export async function clearImageConversations(): Promise<void> {
  cachedConversations = [];
  writeQueue = null;
  await imageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
}
