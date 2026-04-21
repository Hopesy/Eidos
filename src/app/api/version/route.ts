import { getAppVersion } from "@/server/config";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk({ version: await getAppVersion() });
  } catch (error) {
    return jsonError(error);
  }
}
