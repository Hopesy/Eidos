import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ensureAccountWatcherStarted } from "@/server/account-service";
import { createResponse } from "@/server/chatgpt-service";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    await ensureAccountWatcherStarted();
    return jsonOk(await createResponse((await request.json()) as Record<string, unknown>));
  } catch (error) {
    return jsonError(error);
  }
}
