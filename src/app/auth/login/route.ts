import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { getRuntimeConfig } from "@/server/config";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const config = await getRuntimeConfig();
    return jsonOk({ ok: true, version: config.version });
  } catch (error) {
    return jsonError(error);
  }
}
