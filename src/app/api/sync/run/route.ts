import { NextRequest } from "next/server";

import { runSync } from "@/server/cpa-sync/runner";
import { parseJsonBody, syncDirectionBodySchema } from "@/server/request-validation";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        const { direction } = await parseJsonBody(request, syncDirectionBodySchema);

        return jsonOk(await runSync(direction));
    } catch (error) {
        return jsonError(error);
    }
}
