import { NextRequest } from "next/server";

import { getRequestLogs } from "@/server/request-log-store";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

async function GET(request: NextRequest) {
  try {
    return jsonOk({ items: getRequestLogs() });
  } catch (error) {
    return jsonError(error);
  }
}

export { GET };
