import { jsonOk } from "@/server/response";

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
  return jsonOk({
    object: "list",
    data: [buildModelItem("gpt-image-1"), buildModelItem("gpt-image-2")],
  });
}
