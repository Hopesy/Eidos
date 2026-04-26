import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ensureAccountWatcherStarted, generateWithPool } from "@/server/account-service";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import { ImageGenerationError } from "@/server/providers/openai-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        await requireAuthKey(request);
        await ensureAccountWatcherStarted();

        const contentType = request.headers.get("content-type") || "";
        let prompt = "";
        let model = "gpt-image-1";
        let scale = 2;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "Upscale this image").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
            scale = Math.max(2, Math.min(8, Number.parseInt(String(formData.get("scale") || "2"), 10) || 2));
        } else {
            const body = (await request.json()) as Record<string, unknown>;
            prompt = String(body.prompt || "Upscale this image").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
            scale = Math.max(2, Math.min(8, Number.parseInt(String(body.scale || "2"), 10) || 2));
        }

        const upscalePrompt = [
            prompt,
            `请基于上传源图进行高保真超分放大，目标放大倍率约为 ${scale}x。`,
            "保持主体构图、风格、颜色与关键细节一致，优先提升清晰度、材质纹理、边缘细节与整体分辨率表现。",
        ]
            .filter(Boolean)
            .join("\n\n");

        logger.info("images.upscale.route", "request:start", {
            model,
            scale,
            promptLength: prompt.length,
            contentType,
        });

        // Upscale uses the same generation pipeline.
        // The upstream ChatGPT API does not have a native upscale endpoint,
        // so we generate with an upscale-oriented prompt.
        const result = await generateWithPool(upscalePrompt, model, 1, { route: "upscale", operation: "upscale" });

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
        });
        if (error instanceof ImageGenerationError) {
            return jsonError(new ApiError(502, error.message));
        }
        return jsonError(error);
    }
}
