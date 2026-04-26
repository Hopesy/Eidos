import { NextRequest } from "next/server";

import { editWithPool, ensureAccountWatcherStarted, getImageApiServiceConfig } from "@/server/account-service";
import { persistImageResponseItems } from "@/server/image-file-store";
import { logger } from "@/server/logger";
import { addRequestLog } from "@/server/request-log-store";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    editImageResultWithApiService,
    editImageResultWithResponsesApiService,
    ImageGenerationError,
} from "@/server/providers/openai-client";
import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";

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
        let size: ImageGenerationSize = "auto";
        let quality: ImageGenerationQuality = "auto";
        let images: File[] = [];
        let mask: File | null = null;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
            size = (String(formData.get("size") || "auto").trim() || "auto") as ImageGenerationSize;
            quality = (String(formData.get("quality") || "auto").trim() || "auto") as ImageGenerationQuality;
            images = formData.getAll("image").filter((item): item is File => item instanceof File);
            const maskValue = formData.get("mask");
            mask = maskValue instanceof File ? maskValue : null;
        } else {
            const body = (await request.json()) as Record<string, unknown>;
            prompt = String(body.prompt || "").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
            size = (String(body.size || "auto").trim() || "auto") as ImageGenerationSize;
            quality = (String(body.quality || "auto").trim() || "auto") as ImageGenerationQuality;
        }

        if (!prompt) {
            throw new ApiError(400, "prompt is required");
        }
        logModel = model;
        if (images.length === 0) {
            throw new ApiError(400, "edit image is required");
        }

        logger.info("images.edits.route", "request:start", {
            model,
            size,
            quality,
            imageCount: images.length,
            hasMask: Boolean(mask),
            promptLength: prompt.length,
            contentType,
        });

        const imageApiService = getImageApiServiceConfig();
        let result;
        if (imageApiService) {
            usedApiService = true;
            result = imageApiService.apiStyle === "responses"
                ? await editImageResultWithResponsesApiService(imageApiService, {
                    prompt,
                    images,
                    mask,
                    size,
                    quality,
                })
                : await editImageResultWithApiService(imageApiService, {
                prompt,
                model,
                images,
                mask,
                size,
                quality,
            });
            result.data = await persistImageResponseItems(result.data, {
                route: "edits",
                operation: "edit",
                model,
                prompt,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            }, { keepBase64: true });

            const finishedAt = new Date().toISOString();
            addRequestLog({
                startedAt,
                finishedAt,
                endpoint: "POST /v1/images/edits",
                operation: "edit",
                route: "edits",
                model,
                count: 1,
                success: true,
                durationMs: Date.now() - startedAtMs,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            });
        } else {
            result = await editWithPool(prompt, model, images, mask, {
                imageSize: size,
                imageQuality: quality,
            });
        }

        logger.info("images.edits.route", "request:success", {
            model,
            imageCount: Array.isArray(result.data) ? result.data.length : 0,
        });
        return jsonOk(result);
    } catch (error) {
        if (usedApiService && error instanceof Error) {
            addRequestLog({
                startedAt,
                finishedAt: new Date().toISOString(),
                endpoint: "POST /v1/images/edits",
                operation: "edit",
                route: "edits",
                model: logModel,
                count: 1,
                success: false,
                error: error.message.slice(0, 300),
                durationMs: Date.now() - startedAtMs,
                accountEmail: "图像 API 服务",
                accountType: "api_service",
            });
        }
        logger.error("images.edits.route", "request:failed", {
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
        });
        if (error instanceof ImageGenerationError) {
            return jsonError(new ApiError(502, error.message));
        }
        return jsonError(error);
    }
}
