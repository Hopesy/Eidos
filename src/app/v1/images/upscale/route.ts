import { NextRequest } from "next/server";
import type { ImageGenerationQuality } from "@/lib/api";

import { ensureAccountWatcherStarted, getImageApiServiceConfig, upscaleWithApiService, upscaleWithPool } from "@/server/account-service";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";

export const runtime = "nodejs";

function resolveUpscaleQuality(
    rawQuality: unknown,
    rawLegacyScale?: unknown,
): ImageGenerationQuality {
    const quality = String(rawQuality || "").trim().toLowerCase();
    if (quality === "auto" || quality === "low" || quality === "medium" || quality === "high") {
        return quality;
    }

    switch (String(rawLegacyScale || "").trim().toLowerCase()) {
        case "2x":
            return "low";
        case "4x":
            return "medium";
        case "6x":
        case "8x":
            return "high";
        default:
            return "medium";
    }
}

function buildUpscalePrompt(prompt: string, quality: ImageGenerationQuality) {
    const qualityInstruction =
        quality === "low"
            ? "增强档位使用 1K，做保守增强，优先快速提高清晰度。"
            : quality === "medium"
                ? "增强档位使用 2K，明显提升材质纹理、边缘细节与整体清晰度。"
                : quality === "high"
                    ? "增强档位使用 4K，尽可能拉高细节密度、材质表现与成片清晰度。"
                    : "";

    return [
        "请基于上传源图进行高清增强，而不是重绘为全新构图。",
        "保持主体构图、风格、颜色与关键细节一致，优先提升清晰度、材质纹理、边缘细节与整体分辨率表现。",
        qualityInstruction,
        prompt,
    ]
        .filter(Boolean)
        .join("\n\n");
}

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
            return jsonError(new ApiError(resolveImageErrorStatus(error), error.message, {
                error: error.message,
                ...getImageErrorMeta(error),
            }));
        }
        return jsonError(error);
    }
}
