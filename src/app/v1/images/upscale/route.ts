import { NextRequest } from "next/server";
import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";

import { ensureAccountWatcherStarted, upscaleImage } from "@/server/account-service";
import { isAbortError } from "@/server/image/abort";
import { createImageApiError } from "@/server/image/error-response";
import { validateUploadedImages } from "@/server/image/upload-validation";
import { logger } from "@/server/logger";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";
import { buildUpscalePrompt, normalizeImageGenerationSize, normalizeImageOutputFormat, resolveUpscaleQuality } from "@/shared/image-generation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        await ensureAccountWatcherStarted();

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
            throw new ApiError(415, "image upscale requires multipart/form-data with an image file");
        }

        let prompt = "";
        let model = "gpt-image-1";
        let size: ImageGenerationSize = "auto";
        // upscale uses "medium" by default so we still emit a real quality
        // tier when callers omit the param (the workflow expects a target).
        let quality: ImageGenerationQuality = "medium";
        let outputFormat: ImageOutputFormat = "png";
        let image: File | null = null;
        let sourceReference:
            | {
                originalFileId?: string;
                originalGenId?: string;
                previousResponseId?: string;
                imageGenerationCallId?: string;
                conversationId?: string;
                parentMessageId?: string;
                sourceAccountId?: string;
            }
            | null = null;

        const formData = await request.formData();
        prompt = String(formData.get("prompt") || "").trim();
        model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
        size = (String(formData.get("size") || "auto").trim() || "auto") as ImageGenerationSize;
        quality = resolveUpscaleQuality(formData.get("quality"), formData.get("scale"));
        outputFormat = normalizeImageOutputFormat(formData.get("output_format"));
        const imageValue = formData.get("image");
        image = imageValue instanceof File ? imageValue : null;
        const originalFileId = String(formData.get("original_file_id") || "").trim();
        const originalGenId = String(formData.get("original_gen_id") || "").trim();
        const previousResponseId = String(formData.get("previous_response_id") || "").trim();
        const imageGenerationCallId = String(formData.get("image_generation_call_id") || "").trim();
        const conversationId = String(formData.get("conversation_id") || "").trim();
        const parentMessageId = String(formData.get("parent_message_id") || "").trim();
        const sourceAccountId = String(formData.get("source_account_id") || "").trim();
        const hasResponsesReference = Boolean(originalGenId || previousResponseId || imageGenerationCallId);
        const hasConversationReference = Boolean(conversationId && parentMessageId && sourceAccountId);
        if (hasResponsesReference || hasConversationReference) {
            sourceReference = {
                originalFileId: originalFileId || undefined,
                originalGenId: originalGenId || undefined,
                previousResponseId: previousResponseId || undefined,
                imageGenerationCallId: imageGenerationCallId || undefined,
                conversationId: conversationId || undefined,
                parentMessageId: parentMessageId || undefined,
                sourceAccountId: sourceAccountId || undefined,
            };
        }

        if (!image) {
            throw new ApiError(400, "upscale image is required");
        }
        validateUploadedImages([image], { maxCount: 1 });
        size = normalizeImageGenerationSize(size);

        const upscalePrompt = buildUpscalePrompt(prompt, quality);

        logger.info("images.upscale.route", "request:start", {
            model,
            size,
            quality,
            outputFormat,
            promptLength: prompt.length,
            effectivePromptLength: upscalePrompt.length,
            contentType,
            hasImage: Boolean(image),
            hasSourceReference: Boolean(sourceReference?.conversationId && sourceReference.parentMessageId && sourceReference.sourceAccountId),
        });

        const result = await upscaleImage(upscalePrompt, model, image, {
            imageSize: size,
            imageQuality: quality,
            imageFormat: outputFormat,
            sourceReference,
            signal: request.signal,
        });

        logger.info("images.upscale.route", "request:success", {
            model,
            size,
            quality,
            outputFormat,
            imageCount: Array.isArray(result.data) ? result.data.length : 0,
        });
        return jsonOk(result);
    } catch (error) {
        if (isAbortError(error)) {
            logger.warn("images.upscale.route", "request:canceled", {
                message: error instanceof Error ? error.message : String(error),
            });
            return jsonError(new ApiError(499, "request canceled"));
        }
        if (error instanceof ImageGenerationError) {
            const meta = getImageErrorMeta(error);
            if (error.kind === "accepted_pending" || error.kind === "poll_rate_limited") {
                logger.warn("images.upscale.route", "request:pending", {
                    message: error.message,
                    ...meta,
                });
            } else {
                logger.error("images.upscale.route", "request:failed", {
                    message: error.message,
                    name: error.name,
                    ...meta,
                });
            }
            return jsonError(createImageApiError(error));
        }
        logger.error("images.upscale.route", "request:failed", {
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
        });
        return jsonError(error);
    }
}
