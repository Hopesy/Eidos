import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, recoverImageTaskWithAccount } from "@/server/account-service";
import { isAbortError } from "@/server/image/abort";
import { createImageApiError } from "@/server/image/error-response";
import { logger } from "@/server/logger";
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
    const waitMs = body.waitMs;
    const fileIds = cleanStringList(body.fileIds);

    logger.info("image-tasks.recover.route", "request:start", {
      conversationId,
      mode,
      model,
      waitMs,
      fileCount: fileIds.length,
      hasSourceAccountId: Boolean(body.sourceAccountId),
    });

    const result = await recoverImageTaskWithAccount({
      conversationId,
      sourceAccountId: String(body.sourceAccountId || "").trim() || undefined,
      revisedPrompt: String(body.revisedPrompt || "").trim() || undefined,
      fileIds,
      waitMs,
      model,
      signal: request.signal,
    }, {
      endpoint,
      operation,
      route,
      count: 1,
    });

    logger.info("image-tasks.recover.route", "request:success", {
      conversationId,
      mode,
      model,
      imageCount: Array.isArray(result.data) ? result.data.length : 0,
    });
    return jsonOk(result);
  } catch (error) {
    if (isAbortError(error)) {
      logger.warn("image-tasks.recover.route", "request:canceled", {
        message: error instanceof Error ? error.message : String(error),
      });
      return jsonError(new ApiError(499, "request canceled"));
    }
    if (error instanceof ImageGenerationError) {
      const meta = getImageErrorMeta(error);
      if (error.kind === "accepted_pending") {
        logger.warn("image-tasks.recover.route", "request:pending", {
          message: error.message,
          ...meta,
        });
      } else {
        logger.error("image-tasks.recover.route", "request:failed", {
          message: error.message,
          ...meta,
        });
      }
      return jsonError(createImageApiError(error));
    }
    logger.error("image-tasks.recover.route", "request:failed", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
    });
    return jsonError(error);
  }
}
