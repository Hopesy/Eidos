import { NextRequest } from "next/server";

import { getSavedConfig, setSavedConfig } from "@/server/repositories/config-repository";
import { jsonError, jsonOk } from "@/server/response";
import { getDefaultConfigPayload, sanitizeConfigPayload } from "@/shared/app-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {

    const saved = getSavedConfig();
    if (saved) {
      return jsonOk(sanitizeConfigPayload(saved as Record<string, unknown>));
    }

    return jsonOk(getDefaultConfigPayload());
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sanitized = sanitizeConfigPayload(body);
    setSavedConfig(sanitized);
    return jsonOk(sanitized);
  } catch (error) {
    return jsonError(error);
  }
}
