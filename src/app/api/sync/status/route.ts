import { NextRequest } from "next/server";

import { getSyncStatus } from "@/server/cpa-sync";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        return jsonOk(await getSyncStatus());
    } catch (error) {
        return jsonError(error);
    }
}
