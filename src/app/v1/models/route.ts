import { getSavedConfig } from "@/server/repositories/config";
import { jsonOk } from "@/server/response";
import { normalizeImageModels, sanitizeConfigPayload } from "@/shared/app-config";

export const runtime = "nodejs";

function buildModelItem(modelId: string) {
  return {
    id: modelId,
    object: "model",
    created: 0,
    owned_by: "chatgpt2api-next",
  };
}

export async function GET() {
  const savedConfig = sanitizeConfigPayload(getSavedConfig());
  const modelIds = normalizeImageModels(savedConfig.chatgpt?.imageModels);
  return jsonOk({
    object: "list",
    data: modelIds.map(buildModelItem),
  });
}
