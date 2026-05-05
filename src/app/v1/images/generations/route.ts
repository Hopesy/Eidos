import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, generateWithPool } from "@/server/account-service";
import { createImageApiError } from "@/server/image/error-response";
import { parseImageCount } from "@/server/image/request";
import { logger } from "@/server/logger";
import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import { imageGenerationBodySchema, parseJsonBody } from "@/server/request-validation";
import { jsonError, jsonOk } from "@/server/response";
import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import { resolveImageGenerationSize } from "@/shared/image-generation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await ensureAccountWatcherStarted();
    const body = await parseJsonBody(request, imageGenerationBodySchema);

    const prompt = body.prompt;

    const model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
    const count = parseImageCount(body.n);
    const quality = (body.quality || "auto") as ImageGenerationQuality;
    const requestedSize = (body.size || "auto") as ImageGenerationSize;
    const size = requestedSize === "auto" ? resolveImageGenerationSize("auto", quality) : requestedSize;

    logger.info("images.generations.route", "request:start", {
      model,
      count,
      prompt,
      promptLength: prompt.length,
      hasResponseFormat: Boolean(body.response_format),
      size,
      quality,
    });

    const result = await generateWithPool(prompt, model, count, {
      imageSize: size,
      imageQuality: quality,
    });

    logger.info("images.generations.route", "request:success", {
      model,
      count,
      imageCount: Array.isArray(result.data) ? result.data.length : 0,
    });
    return jsonOk(result);
  } catch (error) {
    logger.error("images.generations.route", "request:failed", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
      ...getImageErrorMeta(error),
    });
    if (error instanceof ImageGenerationError) {
      return jsonError(createImageApiError(error));
    }
    return jsonError(error);
  }
}
