import { NextRequest } from "next/server";
import type { ImageGenerationQuality } from "@/lib/api";

import { ensureAccountWatcherStarted, getImageApiServiceConfig, upscaleWithApiService, upscaleWithPool } from "@/server/account-service";
import { createImageApiError } from "@/server/image/error-response";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";
import { buildUpscalePrompt, resolveUpscaleQuality } from "@/shared/image-generation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        await ensureAccountWatcherStarted();

        const contentType = request.headers.get("content-type") || "";
        let prompt = "";
        let model = "gpt-image-1";
        let quality: ImageGenerationQuality = "medium";
        let image: File | null = null;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
            quality = resolveUpscaleQuality(formData.get("quality"), formData.get("scale"));
            const imageValue = formData.get("image");
            image = imageValue instanceof File ? imageValue : null;
        } else {
            const body = (await request.json()) as Record<string, unknown>;
            prompt = String(body.prompt || "").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
            quality = resolveUpscaleQuality(body.quality, body.scale);
        }

        if (!image) {
            throw new ApiError(400, "upscale image is required");
        }

        const upscalePrompt = buildUpscalePrompt(prompt, quality);

        logger.info("images.upscale.route", "request:start", {
            model,
            quality,
            prompt,
            effectivePrompt: upscalePrompt,
            promptLength: prompt.length,
            contentType,
            hasImage: Boolean(image),
        });

        const imageApiService = getImageApiServiceConfig();
        let result;
        if (imageApiService) {
            result = await upscaleWithApiService(upscalePrompt, model, image, { imageQuality: quality });
        } else {
            result = await upscaleWithPool(upscalePrompt, model, image, { imageQuality: quality });
        }

        logger.info("images.upscale.route", "request:success", {
            model,
            quality,
            imageCount: Array.isArray(result.data) ? result.data.length : 0,
        });
        return jsonOk(result);
    } catch (error) {
        logger.error("images.upscale.route", "request:failed", {
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
