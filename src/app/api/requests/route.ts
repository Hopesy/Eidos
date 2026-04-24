import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

const requestLogs: Array<Record<string, unknown>> = [];

async function GET(request: NextRequest) {
  try {
    await requireAuthKey(request);
    return jsonOk({ items: requestLogs });
  } catch (error) {
    return jsonError(error);
  }
}

export { GET };
