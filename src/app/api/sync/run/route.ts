import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        await requireAuthKey(request);

        const body = (await request.json()) as { direction?: string };
        const direction = String(body.direction || "").trim();
        if (direction !== "pull" && direction !== "push") {
            throw new ApiError(400, 'direction must be "pull" or "push"');
        }

        // Sync is not implemented in the Next.js standalone version.
        return jsonOk({
            ok: false,
            error: "CPA sync is not available in this deployment",
            direction,
            uploaded: 0,
            upload_failed: 0,
            downloaded: 0,
            download_failed: 0,
            remote_deleted: 0,
            disabled_aligned: 0,
            disabled_align_failed: 0,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
        });
    } catch (error) {
        return jsonError(error);
    }
}
