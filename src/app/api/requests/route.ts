import { NextRequest } from "next/server";

import { getRequestLogs } from "@/server/repositories/request-log";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

function readLimit(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (!rawLimit) {
    return undefined;
  }

  const limit = Number.parseInt(rawLimit, 10);
  return Number.isFinite(limit) ? limit : undefined;
}

async function GET(request: NextRequest) {
  try {
    return jsonOk({ items: getRequestLogs(readLimit(request)) });
  } catch (error) {
    return jsonError(error);
  }
}

export { GET };
