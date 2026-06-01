import { ImageClient } from "./image-client";

import { listAccounts } from "@/server/account-service";
import { getImageApiServiceConfig } from "@/server/image/api-service/service-config";
import { getSavedConfig } from "@/server/repositories/config";
import { normalizeImageConversationRuntimeRecords } from "@/server/repositories/image/conversation-repository";
import { listImageFiles } from "@/server/repositories/image/file-repository";
import { listRecoverableImageUpstreamTasks } from "@/server/repositories/image/upstream-task-repository";
import { normalizeImageOutputFormat } from "@/shared/image-generation";
import { normalizeImageModels, sanitizeConfigPayload } from "@/shared/app-config";
import type { ImageConversation } from "@/store/image-conversations";

export const dynamic = "force-dynamic";

function formatAvailableQuota(accounts: Awaited<ReturnType<typeof listAccounts>>) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用" && account.status !== "异常");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

export default async function ImagePage() {
  const [initialConversations, initialFiles, accounts] = await Promise.all([
    normalizeImageConversationRuntimeRecords(),
    listImageFiles(),
    listAccounts(),
  ]);
  const initialUsesImageApiService = Boolean(getImageApiServiceConfig());
  const savedConfig = sanitizeConfigPayload(getSavedConfig());
  const initialImageFormat = normalizeImageOutputFormat(savedConfig.chatgpt?.imageFormat);
  const initialImageModels = normalizeImageModels(savedConfig.chatgpt?.imageModels);
  const initialImageModel = initialImageModels[0] || "gpt-image-2";
  const initialImageModelOptions = initialImageModels.map((modelId) => ({ label: modelId, value: modelId }));

  return (
    <ImageClient
      initialConversations={initialConversations as ImageConversation[]}
      initialFiles={initialFiles}
      initialRecoverableTasks={listRecoverableImageUpstreamTasks(30)}
      initialAvailableQuota={formatAvailableQuota(accounts)}
      initialUsesImageApiService={initialUsesImageApiService}
      initialImageFormat={initialImageFormat}
      initialImageModel={initialImageModel}
      initialImageModelOptions={initialImageModelOptions}
    />
  );
}
