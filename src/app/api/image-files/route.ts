import { listImageFiles } from "@/server/repositories/image/file-repository";
import { jsonError, jsonOk } from "@/server/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ items: listImageFiles() });
  } catch (error) {
    return jsonError(error);
  }
}
