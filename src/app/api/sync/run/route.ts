import { NextRequest } from "next/server";

import { runSync } from "@/server/cpa-sync";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {

        const body = (await request.json()) as { direction?: string };
        const direction = String(body.direction || "").trim();
        if (direction !== "pull" && direction !== "push" && direction !== "both") {
            throw new ApiError(400, 'direction must be "pull", "push" or "both"');
        }

        return jsonOk(await runSync(direction));
    } catch (error) {
        return jsonError(error);
    }
}
