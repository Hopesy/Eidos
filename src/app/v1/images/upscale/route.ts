import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, getImageApiServiceConfig, upscaleWithApiService, upscaleWithPool } from "@/server/account-service";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";

export const runtime = "nodejs";

function resolveImageErrorStatus(error: ImageGenerationError) {
    if (error.statusCode === 401) {
        return 401;
    }
    if (error.statusCode === 429) {
        return 429;
    }
    if (error.kind === "input_blocked") {
        return 400;
    }
    return 502;
}

export async function POST(request: NextRequest) {
    try {
        await ensureAccountWatcherStarted();

        const contentType = request.headers.get("content-type") || "";
        let prompt = "";
        let model = "gpt-image-1";
        let scale = 2;
        let image: File | null = null;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
            scale = Math.max(2, Math.min(8, Number.parseInt(String(formData.get("scale") || "2"), 10) || 2));
            const imageValue = formData.get("image");
            image = imageValue instanceof File ? imageValue : null;
        } else {
            const body = (await request.json()) as Record<string, unknown>;
            prompt = String(body.prompt || "").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
            scale = Math.max(2, Math.min(8, Number.parseInt(String(body.scale || "2"), 10) || 2));
        }

        if (!image) {
            throw new ApiError(400, "upscale image is required");
        }

        const upscalePrompt = [
            `请基于上传源图进行高保真超分放大，目标放大倍率约为 ${scale}x。`,
            "保持主体构图、风格、颜色与关键细节一致，优先提升清晰度、材质纹理、边缘细节与整体分辨率表现。",
            prompt,
        ]
            .filter(Boolean)
            .join("\n\n");

        logger.info("images.upscale.route", "request:start", {
            model,
            scale,
            prompt,
            effectivePrompt: upscalePrompt,
            promptLength: prompt.length,
            contentType,
            hasImage: Boolean(image),
        });

        const imageApiService = getImageApiServiceConfig();
        let result;
        if (imageApiService) {
            result = await upscaleWithApiService(upscalePrompt, model, image, { scale });
        } else {
            result = await upscaleWithPool(upscalePrompt, model, image, { scale });
        }

        logger.info("images.upscale.route", "request:success", {
            model,
            scale,
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
            return jsonError(new ApiError(resolveImageErrorStatus(error), error.message, {
                error: error.message,
                ...getImageErrorMeta(error),
            }));
        }
        return jsonError(error);
    }
}
