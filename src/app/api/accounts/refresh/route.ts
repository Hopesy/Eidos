import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, listTokens, refreshAccounts } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    const body = (await request.json()) as { access_tokens?: string[] };
    let accessTokens = Array.isArray(body.access_tokens)
      ? body.access_tokens.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (accessTokens.length === 0) {
      accessTokens = await listTokens();
    }
    return jsonOk(await refreshAccounts(accessTokens, { markRefreshedAt: true }));
  } catch (error) {
    return jsonError(error);
  }
}
