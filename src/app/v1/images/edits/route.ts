import { NextRequest } from "next/server";

import { editWithApiService, editWithPool, ensureAccountWatcherStarted, getImageApiServiceConfig } from "@/server/account-service";
import { isAbortError } from "@/server/image/abort";
import { createImageApiError } from "@/server/image/error-response";
import { logger } from "@/server/logger";
import { parseJsonBody, recordBodySchema } from "@/server/request-validation";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import {
    getImageErrorMeta,
    ImageGenerationError,
} from "@/server/providers/openai-client";
import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import { normalizeImageGenerationSize, normalizeImageOutputFormat, resolveImageGenerationSize } from "@/shared/image-generation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        await ensureAccountWatcherStarted();

        const contentType = request.headers.get("content-type") || "";
        let prompt = "";
        let model = "gpt-image-1";
        let size: ImageGenerationSize = "auto";
        let quality: ImageGenerationQuality = "auto";
        let outputFormat: ImageOutputFormat = "png";
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
            outputFormat = normalizeImageOutputFormat(formData.get("output_format"));
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
            const body = await parseJsonBody(request, recordBodySchema);
            prompt = String(body.prompt || "").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
            size = (String(body.size || "auto").trim() || "auto") as ImageGenerationSize;
            quality = (String(body.quality || "auto").trim() || "auto") as ImageGenerationQuality;
            outputFormat = normalizeImageOutputFormat(body.output_format);
        }

        if (!prompt) {
            throw new ApiError(400, "prompt is required");
        }
        if (images.length === 0) {
            throw new ApiError(400, "edit image is required");
        }
        size = size === "auto" ? resolveImageGenerationSize("auto", quality) : normalizeImageGenerationSize(size);

        logger.info("images.edits.route", "request:start", {
            model,
            size,
            quality,
            outputFormat,
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
                imageFormat: outputFormat,
                sourceReference: sourceReference ? {
                    originalFileId: sourceReference.originalFileId,
                    originalGenId: sourceReference.originalGenId,
                    previousResponseId: sourceReference.previousResponseId,
                    imageGenerationCallId: sourceReference.imageGenerationCallId,
                    conversationId: sourceReference.conversationId,
                    parentMessageId: sourceReference.parentMessageId,
                    sourceAccountId: sourceReference.sourceAccountId,
                } : null,
                signal: request.signal,
            });
        } else {
            result = await editWithPool(prompt, model, images, mask, {
                imageSize: size,
                imageQuality: quality,
                imageFormat: outputFormat,
                signal: request.signal,
            });
        }

        logger.info("images.edits.route", "request:success", {
            model,
            imageCount: Array.isArray(result.data) ? result.data.length : 0,
        });
        return jsonOk(result);
    } catch (error) {
        if (isAbortError(error)) {
            logger.warn("images.edits.route", "request:canceled", {
                message: error instanceof Error ? error.message : String(error),
            });
            return jsonError(new ApiError(499, "request canceled"));
        }
        if (error instanceof ImageGenerationError) {
            const meta = getImageErrorMeta(error);
            if (error.kind === "accepted_pending" || error.kind === "poll_rate_limited") {
                logger.warn("images.edits.route", "request:pending", {
                    message: error.message,
                    ...meta,
                });
            } else {
                logger.error("images.edits.route", "request:failed", {
                    message: error.message,
                    name: error.name,
                    ...meta,
                });
            }
            return jsonError(createImageApiError(error));
        }
        logger.error("images.edits.route", "request:failed", {
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
        });
        return jsonError(error);
    }
}
