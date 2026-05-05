import { ImageClient } from "./image-client";

import { listAccounts } from "@/server/account-service";
import { getImageApiServiceConfig } from "@/server/image/api-service/service-config";
import { listImageConversationRecords } from "@/server/repositories/image/conversation-repository";
import { listImageFiles } from "@/server/repositories/image/file-repository";
import { listRecoverableImageUpstreamTasks } from "@/server/repositories/image/upstream-task-repository";
import type { ImageConversation } from "@/store/image-conversations";

export const dynamic = "force-dynamic";

function formatAvailableQuota(accounts: Awaited<ReturnType<typeof listAccounts>>) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用" && account.status !== "异常");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

export default async function ImagePage() {
  const [initialConversations, initialFiles, accounts] = await Promise.all([
    listImageConversationRecords(),
    listImageFiles(),
    listAccounts(),
  ]);
  const initialUsesImageApiService = Boolean(getImageApiServiceConfig());

  return (
    <ImageClient
      initialConversations={initialConversations as ImageConversation[]}
      initialFiles={initialFiles}
      initialRecoverableTasks={listRecoverableImageUpstreamTasks(30)}
      initialAvailableQuota={formatAvailableQuota(accounts)}
      initialUsesImageApiService={initialUsesImageApiService}
    />
  );
}
