import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { addAccounts, deleteAccounts, ensureAccountWatcherStarted, listAccounts, refreshAccounts } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuthKey(request);
    await ensureAccountWatcherStarted();
    return jsonOk({ items: await listAccounts() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    await ensureAccountWatcherStarted();
    const body = (await request.json()) as { tokens?: string[] };
    const tokens = Array.isArray(body.tokens) ? body.tokens.map((item) => String(item || "").trim()).filter(Boolean) : [];
    if (tokens.length === 0) {
      throw new ApiError(400, "tokens is required");
    }
    const result = await addAccounts(tokens);
    const refreshed = await refreshAccounts(tokens);
    return jsonOk({
      ...result,
      refreshed: refreshed.refreshed,
      errors: refreshed.errors,
      items: refreshed.items.length > 0 ? refreshed.items : result.items,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const body = (await request.json()) as { tokens?: string[] };
    const tokens = Array.isArray(body.tokens) ? body.tokens.map((item) => String(item || "").trim()).filter(Boolean) : [];
    if (tokens.length === 0) {
      throw new ApiError(400, "tokens is required");
    }
    return jsonOk(await deleteAccounts(tokens));
  } catch (error) {
    return jsonError(error);
  }
}
