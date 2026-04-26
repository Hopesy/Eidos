import { NextRequest } from "next/server";

import { ensureAccountWatcherStarted, getImageApiServiceConfig, upscaleWithPool } from "@/server/account-service";
import { persistImageResponseItems } from "@/server/image-file-store";
import { logger } from "@/server/logger";
import { addRequestLog } from "@/server/request-log-store";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    editImageResultWithApiService,
    editImageResultWithResponsesApiService,
    ImageGenerationError,
} from "@/server/providers/openai-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let logModel = "gpt-image-1";
    let usedApiService = false;
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

        logModel = model;

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
            promptLength: prompt.length,
            contentType,
            hasImage: Boolean(image),
        });

        const imageApiService = getImageApiServiceConfig();
        let result;
        if (imageApiService) {
            usedApiService = true;
            result = imageApiService.apiStyle === "responses"
                ? await editImageResultWithResponsesApiService(imageApiService, {
                    prompt: upscalePrompt,
                    images: [image],
                })
                : await editImageResultWithApiService(imageApiService, {
                    prompt: upscalePrompt,
                    model,
                    images: [image],
                });

            result.data = await persistImageResponseItems(result.data, {
                route: "upscale",
                operation: "upscale",
                model,
                prompt: upscalePrompt,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            }, { keepBase64: true });

            addRequestLog({
                startedAt,
                finishedAt: new Date().toISOString(),
                endpoint: "POST /v1/images/upscale",
                operation: "upscale",
                route: "upscale",
                model,
                count: 1,
                success: true,
                durationMs: Date.now() - startedAtMs,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            });
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
        if (usedApiService && error instanceof Error) {
            addRequestLog({
                startedAt,
                finishedAt: new Date().toISOString(),
                endpoint: "POST /v1/images/upscale",
                operation: "upscale",
                route: "upscale",
                model: logModel,
                count: 1,
                success: false,
                error: error.message.slice(0, 300),
                durationMs: Date.now() - startedAtMs,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            });
        }
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
