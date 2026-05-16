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

const activeTasks = new Map<string, ActiveImageTask>();
const activeTaskRefs = new Map<string, number>();
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
  activeTaskRefs.set(key, (activeTaskRefs.get(key) ?? 0) + 1);
  activeTasks.set(key, task);
  notifyListeners();
}

export function finishImageTask(conversationId: string, turnId: string): void {
  const key = getTaskKey(conversationId, turnId);
  const refs = activeTaskRefs.get(key) ?? 0;
  if (refs > 1) {
    activeTaskRefs.set(key, refs - 1);
    notifyListeners();
    return;
  }

  activeTaskRefs.delete(key);
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
