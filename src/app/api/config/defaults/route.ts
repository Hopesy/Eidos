import { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/server/response";
import { getDefaultConfigPayload } from "@/shared/app-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {

        return jsonOk(getDefaultConfigPayload());
    } catch (error) {
        return jsonError(error);
    }
}
