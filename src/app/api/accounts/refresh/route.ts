import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ensureAccountWatcherStarted, listTokens, refreshAccounts } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    await ensureAccountWatcherStarted();
    const body = (await request.json()) as { access_tokens?: string[] };
    let accessTokens = Array.isArray(body.access_tokens)
      ? body.access_tokens.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (accessTokens.length === 0) {
      accessTokens = await listTokens();
    }
    if (accessTokens.length === 0) {
      throw new ApiError(400, "access_tokens is required");
    }
    return jsonOk(await refreshAccounts(accessTokens));
  } catch (error) {
    return jsonError(error);
  }
}
