import type { NextRequest } from "next/server";

import { getRuntimeConfig } from "@/server/config";
import { ApiError } from "@/server/response";

export function extractBearerToken(authorization: string | null) {
  const [scheme, value] = String(authorization || "").split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) {
    return "";
  }
  return value.trim();
}

export async function requireAuthKey(request: NextRequest) {
  const config = await getRuntimeConfig();
  if (!config.authKey.trim()) {
    return;
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  if (token !== config.authKey.trim()) {
    throw new ApiError(401, "authorization is invalid");
  }
}
