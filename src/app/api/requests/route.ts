import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

// In-memory request log store
const requestLogs: Array<Record<string, unknown>> = [];

export function appendRequestLog(entry: Record<string, unknown>) {
    requestLogs.unshift(entry);
    // Keep last 500 entries
    if (requestLogs.length > 500) {
        requestLogs.length = 500;
    }
}

export async function GET(request: NextRequest) {
    try {
        await requireAuthKey(request);
        return jsonOk({ items: requestLogs });
    } catch (error) {
        return jsonError(error);
    }
}
