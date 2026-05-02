import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, listTokens, refreshAccounts } from "@/server/account-service";
import { accessTokenListBodySchema, cleanStringList, parseJsonBody } from "@/server/request-validation";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    const body = await parseJsonBody(request, accessTokenListBodySchema);
    let accessTokens = cleanStringList(body.access_tokens);
    if (accessTokens.length === 0) {
      accessTokens = await listTokens();
    }
    return jsonOk(await refreshAccounts(accessTokens, { markRefreshedAt: true }));
  } catch (error) {
    return jsonError(error);
  }
}
