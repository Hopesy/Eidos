import { httpRequest } from "@/lib/request";

import type { SyncRunResult, SyncStatusResponse } from "./types";

export async function fetchSyncStatus() {
  return httpRequest<SyncStatusResponse>("/api/sync/status");
}

export async function runSync(direction: "pull" | "push" | "both") {
  return httpRequest<SyncRunResult>("/api/sync/run", {
    method: "POST",
    body: { direction },
  });
}
