import { NextRequest } from "next/server";

import { listAccounts, updateAccount } from "@/server/account-service";
import { accountUpdateBodySchema, parseJsonBody } from "@/server/request-validation";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request, accountUpdateBodySchema);
    const accessToken = body.access_token;
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
