import type { SyncRunResult } from "@/lib/api";
import {
  addAccounts,
  listAccounts,
  refreshAccounts,
  updateAccount,
} from "@/server/account-service";
import { saveSyncRun } from "@/server/repositories/sync-run-repository";

import { CpaClient, getCpaConfig, loadRemoteAuthFiles } from "./client";
import {
  buildAccountName,
  buildRemoteAuthContent,
  createInitialSyncResult,
  createUnconfiguredSyncResult,
  isLocalDisabled,
} from "./shared";

export async function runSync(
  direction: "pull" | "push" | "both",
): Promise<SyncRunResult> {
  const config = await getCpaConfig();
  const startedAt = new Date().toISOString();

  if (!config.enabled) {
    return createUnconfiguredSyncResult(direction, startedAt);
  }

  const client = new CpaClient(config);
  const result = createInitialSyncResult(direction, startedAt);

  try {
    const localAccounts = await listAccounts();
    const remoteMap = await loadRemoteAuthFiles(client);

    if (direction === "pull" || direction === "both") {
      const remoteOnlyTokens = Array.from(remoteMap.values())
        .filter(
          (item) =>
            !localAccounts.some(
              (account) => account.access_token === item.accessToken,
            ),
        )
        .map((item) => item.accessToken);

      if (remoteOnlyTokens.length > 0) {
        const added = await addAccounts(remoteOnlyTokens);
        result.downloaded += added.added ?? remoteOnlyTokens.length;
        await refreshAccounts(remoteOnlyTokens);
      }

      for (const remote of remoteMap.values()) {
        const local = localAccounts.find(
          (account) => account.access_token === remote.accessToken,
        );
        if (!local) {
          continue;
        }
        const shouldDisable = remote.disabled;
        const isDisabled = isLocalDisabled(local);
        if (shouldDisable !== isDisabled) {
          try {
            await updateAccount(local.access_token, {
              status: shouldDisable ? "禁用" : "正常",
            });
            result.disabled_aligned += 1;
          } catch {
            result.disabled_align_failed += 1;
          }
        }
      }
    }

    if (direction === "push" || direction === "both") {
      for (const account of localAccounts) {
        const remote = remoteMap.get(account.access_token);
        if (!remote) {
          try {
            await client.uploadAuthFile(
              buildAccountName(account.access_token),
              buildRemoteAuthContent(account),
            );
            result.uploaded += 1;
          } catch {
            result.upload_failed += 1;
          }
          continue;
        }

        if (remote.disabled !== isLocalDisabled(account)) {
          try {
            await client.patchAuthFileStatus(
              remote.name,
              isLocalDisabled(account),
            );
            result.disabled_aligned += 1;
          } catch {
            result.disabled_align_failed += 1;
          }
        }
      }
    }
  } catch (error) {
    result.ok = false;
    result.error =
      error instanceof Error ? error.message : "执行 CPA 同步失败";
  }

  result.finished_at = new Date().toISOString();
  saveSyncRun(result);
  return result;
}
