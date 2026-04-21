import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { listAccounts, updateAccount } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import type { AccountStatus, AccountType } from "@/server/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const body = (await request.json()) as {
      access_token?: string;
      type?: AccountType;
      status?: AccountStatus;
      quota?: number;
    };
    const accessToken = String(body.access_token || "").trim();
    if (!accessToken) {
      throw new ApiError(400, "access_token is required");
    }
    const updates = Object.fromEntries(
      Object.entries({
        type: body.type,
        status: body.status,
        quota: body.quota,
      }).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "no updates provided");
    }
    const account = await updateAccount(accessToken, updates);
    if (!account) {
      throw new ApiError(404, "account not found");
    }
    return jsonOk({ item: account, items: await listAccounts() });
  } catch (error) {
    return jsonError(error);
  }
}
