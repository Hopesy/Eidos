import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { getSyncStatus } from "@/server/cpa-sync";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        await requireAuthKey(request);
        return jsonOk(await getSyncStatus());
    } catch (error) {
        return jsonError(error);
    }
}
