import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        await requireAuthKey(request);

        // Sync is not implemented in the Next.js standalone version.
        // Return a "not configured" stub so the UI renders gracefully.
        return jsonOk({
            configured: false,
            local: 0,
            remote: 0,
            summary: {
                synced: 0,
                pending_upload: 0,
                remote_only: 0,
                remote_deleted: 0,
            },
            accounts: [],
            disabledMismatch: 0,
            lastRun: null,
        });
    } catch (error) {
        return jsonError(error);
    }
}
