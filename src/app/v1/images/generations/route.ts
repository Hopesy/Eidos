import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ensureAccountWatcherStarted, generateWithPool } from "@/server/account-service";
import { parseImageCount } from "@/server/image-request";
import { logger } from "@/server/logger";
import { ImageGenerationError } from "@/server/providers/openai-client";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    await ensureAccountWatcherStarted();
    const body = (await request.json()) as {
      prompt?: string;
      model?: string;
      n?: number;
      response_format?: string;
      size?: string;
      quality?: string;
    };

    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      throw new ApiError(400, "prompt is required");
    }

    const model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
    const count = parseImageCount(body.n);
    const size = (String(body.size || "auto").trim() || "auto") as ImageGenerationSize;
    const quality = (String(body.quality || "auto").trim() || "auto") as ImageGenerationQuality;

    logger.info("images.generations.route", "request:start", {
      model,
      count,
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
    });
    if (error instanceof ImageGenerationError) {
      return jsonError(new ApiError(502, error.message));
    }
    return jsonError(error);
  }
}
