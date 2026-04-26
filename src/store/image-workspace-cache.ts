"use client";

type CachedImageWorkspaceState = {
  selectedConversationId: string | null;
  isDraftSelection: boolean;
};

let cachedImageWorkspaceState: CachedImageWorkspaceState = {
  selectedConversationId: null,
  isDraftSelection: true,
};

export function getCachedImageWorkspaceState(): CachedImageWorkspaceState {
  return cachedImageWorkspaceState;
}

export function setCachedImageWorkspaceState(value: CachedImageWorkspaceState): void {
  cachedImageWorkspaceState = value;
}
