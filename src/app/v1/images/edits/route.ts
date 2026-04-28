import { NextRequest } from "next/server";

import { editWithApiService, editWithPool, ensureAccountWatcherStarted, getImageApiServiceConfig } from "@/server/account-service";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";
import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";

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
        let size: ImageGenerationSize = "auto";
        let quality: ImageGenerationQuality = "auto";
        let images: File[] = [];
        let mask: File | null = null;
        let sourceReference:
            | {
                originalFileId: string;
                originalGenId: string;
                previousResponseId?: string;
                imageGenerationCallId?: string;
                conversationId?: string;
                parentMessageId?: string;
                sourceAccountId?: string;
            }
            | null = null;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
            size = (String(formData.get("size") || "auto").trim() || "auto") as ImageGenerationSize;
            quality = (String(formData.get("quality") || "auto").trim() || "auto") as ImageGenerationQuality;
            images = formData.getAll("image").filter((item): item is File => item instanceof File);
            const maskValue = formData.get("mask");
            mask = maskValue instanceof File ? maskValue : null;
            const originalFileId = String(formData.get("original_file_id") || "").trim();
            const originalGenId = String(formData.get("original_gen_id") || "").trim();
            if (originalFileId && originalGenId) {
                sourceReference = {
                    originalFileId,
                    originalGenId,
                    previousResponseId: String(formData.get("previous_response_id") || "").trim() || undefined,
                    imageGenerationCallId: String(formData.get("image_generation_call_id") || "").trim() || undefined,
                    conversationId: String(formData.get("conversation_id") || "").trim() || undefined,
                    parentMessageId: String(formData.get("parent_message_id") || "").trim() || undefined,
                    sourceAccountId: String(formData.get("source_account_id") || "").trim() || undefined,
                };
            }
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
        if (images.length === 0) {
            throw new ApiError(400, "edit image is required");
        }

        logger.info("images.edits.route", "request:start", {
            model,
            size,
            quality,
            imageCount: images.length,
            hasMask: Boolean(mask),
            prompt,
            promptLength: prompt.length,
            contentType,
        });

        const imageApiService = getImageApiServiceConfig();
        let result;
        if (imageApiService) {
            result = await editWithApiService(prompt, model, images, mask, {
                imageSize: size,
                imageQuality: quality,
                sourceReference: sourceReference ? {
                    originalFileId: sourceReference.originalFileId,
                    originalGenId: sourceReference.originalGenId,
                    previousResponseId: sourceReference.previousResponseId,
                    imageGenerationCallId: sourceReference.imageGenerationCallId,
                    conversationId: sourceReference.conversationId,
                    parentMessageId: sourceReference.parentMessageId,
                    sourceAccountId: sourceReference.sourceAccountId,
                } : null,
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
        logger.error("images.edits.route", "request:failed", {
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
