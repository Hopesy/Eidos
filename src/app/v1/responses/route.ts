import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted } from "@/server/account-service";
import { createResponse } from "@/server/chatgpt-service";
import { parseJsonBody, recordBodySchema } from "@/server/request-validation";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    return jsonOk(await createResponse(await parseJsonBody(request, recordBodySchema)));
  } catch (error) {
    return jsonError(error);
  }
}
