import { randomUUID } from "node:crypto";

import type { SyncRunResult } from "@/lib/api";
import { getDb } from "@/server/db";

export function getLastSyncRun(): SyncRunResult | null {
  const row = getDb()
    .prepare("SELECT data_json FROM sync_runs ORDER BY created_at DESC LIMIT 1")
    .get() as { data_json?: string } | undefined;
  if (!row?.data_json) return null;
  try {
    return JSON.parse(row.data_json) as SyncRunResult;
  } catch {
    return null;
  }
}

export function saveSyncRun(run: SyncRunResult): void {
  getDb().prepare(`
    INSERT INTO sync_runs (id, data_json, direction, ok, started_at, finished_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    JSON.stringify(run),
    run.direction ?? null,
    run.ok ? 1 : 0,
    run.started_at,
    run.finished_at,
    run.finished_at || new Date().toISOString(),
  );
}
