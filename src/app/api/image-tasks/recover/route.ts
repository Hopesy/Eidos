import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, recoverImageTaskWithAccount } from "@/server/account-service";
import { createImageApiError } from "@/server/image/error-response";
import { listRecoverableImageUpstreamTasks } from "@/server/repositories/image/upstream-task-repository";
import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import { cleanStringList, imageTaskRecoverBodySchema, parseJsonBody } from "@/server/request-validation";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get("limit") || 20) || 20));
    return jsonOk({
      items: listRecoverableImageUpstreamTasks(limit),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    const body = await parseJsonBody(request, imageTaskRecoverBodySchema);

    const conversationId = body.conversationId;
    const model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
    const mode = body.mode || "generate";

    const route = mode === "edit" ? "edits" : mode === "upscale" ? "upscale" : "generations";
    const operation = mode === "edit" ? "edit" : mode === "upscale" ? "upscale" : "generate";
    const endpoint = route === "generations" ? "POST /v1/images/generations" : `POST /v1/images/${route}`;

    const result = await recoverImageTaskWithAccount({
      conversationId,
      sourceAccountId: String(body.sourceAccountId || "").trim() || undefined,
      revisedPrompt: String(body.revisedPrompt || "").trim() || undefined,
      fileIds: cleanStringList(body.fileIds),
      waitMs: body.waitMs,
      model,
    }, {
      endpoint,
      operation,
      route,
      count: 1,
    });

    return jsonOk(result);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return jsonError(createImageApiError(error));
    }
    return jsonError(error);
  }
}
