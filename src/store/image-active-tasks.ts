"use client";

import type { ImageMode } from "@/store/image-conversations";

export type ActiveImageTask = {
  conversationId: string;
  turnId: string;
  mode: ImageMode;
  count: number;
  variant: "standard" | "selection-edit";
  startedAt: number;
};

type Listener = () => void;

// 内部 Map 和 Set
const activeTasks = new Map<string, ActiveImageTask>();
const listeners = new Set<Listener>();

// key 格式：conversationId:turnId
function getTaskKey(conversationId: string, turnId: string): string {
  return `${conversationId}:${turnId}`;
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function startImageTask(task: ActiveImageTask): void {
  const key = getTaskKey(task.conversationId, task.turnId);
  activeTasks.set(key, task);
  notifyListeners();
}

export function finishImageTask(conversationId: string, turnId: string): void {
  const key = getTaskKey(conversationId, turnId);
  activeTasks.delete(key);
  notifyListeners();
}

export function isImageTaskActive(conversationId: string, turnId: string): boolean {
  const key = getTaskKey(conversationId, turnId);
  return activeTasks.has(key);
}

export function listActiveImageTasks(): ActiveImageTask[] {
  return Array.from(activeTasks.values()).sort((a, b) => a.startedAt - b.startedAt);
}

export function subscribeImageTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
