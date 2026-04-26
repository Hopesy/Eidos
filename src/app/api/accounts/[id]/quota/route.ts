import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, fetchAccountRemoteInfo, refreshAccountState } from "@/server/account-service";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureAccountWatcherStarted();

    const { id } = await params;
    const doRefresh = request.nextUrl.searchParams.get("refresh") !== "false";

    let refreshed = false;
    let refreshError: string | undefined;

    if (doRefresh) {
      try {
        await refreshAccountState(id);
        refreshed = true;
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
      }
    }

    let info: Record<string, unknown> = {};
    try {
      info = await fetchAccountRemoteInfo(id) as Record<string, unknown>;
    } catch {
      // ignore
    }

    const limitsProgress = Array.isArray(info.limits_progress)
      ? (info.limits_progress as Array<Record<string, unknown>>)
      : [];
    const imageGen = limitsProgress.find(
      (item) => item.feature_name === "image_gen",
    );

    return jsonOk({
      id,
      email: info.email ?? null,
      status: info.status ?? "正常",
      type: info.type ?? "Free",
      quota: Number(info.quota ?? 0),
      image_gen_remaining: imageGen ? Number(imageGen.remaining ?? 0) : null,
      image_gen_reset_after: imageGen
        ? String(imageGen.reset_after || "")
        : null,
      refresh_requested: doRefresh,
      refreshed,
      refresh_error: refreshError,
    });
  } catch (error) {
    return jsonError(error);
  }
}
