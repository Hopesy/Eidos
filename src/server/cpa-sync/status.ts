import type { SyncStatusResponse } from "@/lib/api";
import { listAccounts } from "@/server/account-service";
import { getLastSyncRun } from "@/server/repositories/sync-run-repository";

import { CpaClient, getCpaConfig, loadRemoteAuthFiles } from "./client";
import {
  buildAccountName,
  createEmptySyncStatus,
  isLocalDisabled,
} from "./shared";

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const config = await getCpaConfig();
  if (!config.enabled) {
    return createEmptySyncStatus(false, getLastSyncRun());
  }

  const client = new CpaClient(config);
  const [localAccounts, remoteMap] = await Promise.all([
    listAccounts(),
    loadRemoteAuthFiles(client),
  ]);
  const status = createEmptySyncStatus(true, getLastSyncRun());
  status.local = localAccounts.length;
  status.remote = remoteMap.size;

  const localTokenSet = new Set(
    localAccounts.map((item) => item.access_token),
  );

  for (const account of localAccounts) {
    const remote = remoteMap.get(account.access_token);
    const syncStatus = remote ? "synced" : "pending_upload";
    status.summary[syncStatus] += 1;
    if (remote && remote.disabled !== isLocalDisabled(account)) {
      status.disabledMismatch += 1;
    }
    status.accounts.push({
      name: remote?.name || buildAccountName(account.access_token),
      status: syncStatus,
      location: remote ? "both" : "local",
      localDisabled: isLocalDisabled(account),
      remoteDisabled: remote?.disabled ?? null,
    });
  }

  for (const remote of remoteMap.values()) {
    if (localTokenSet.has(remote.accessToken)) {
      continue;
    }
    status.summary.remote_only += 1;
    status.accounts.push({
      name: remote.name,
      status: "remote_only",
      location: "remote",
      localDisabled: null,
      remoteDisabled: remote.disabled,
    });
  }

  status.accounts.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return status;
}
