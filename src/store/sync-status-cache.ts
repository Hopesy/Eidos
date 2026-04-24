"use client";

import type { SyncStatusResponse } from "@/lib/api";

let cachedSyncStatus: SyncStatusResponse | null = null;

export function getCachedSyncStatus(): SyncStatusResponse | null {
    return cachedSyncStatus;
}

export function setCachedSyncStatus(value: SyncStatusResponse | null): void {
    cachedSyncStatus = value;
}

export function clearCachedSyncStatus(): void {
    cachedSyncStatus = null;
}
