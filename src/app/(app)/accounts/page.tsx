import { AccountsClient } from "./accounts-client";

import { getSyncStatus } from "@/server/cpa-sync/status";
import { listAccounts } from "@/server/account-service";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [initialAccounts, initialSyncStatus] = await Promise.all([
    listAccounts(),
    getSyncStatus(),
  ]);

  return <AccountsClient initialAccounts={initialAccounts} initialSyncStatus={initialSyncStatus} />;
}
