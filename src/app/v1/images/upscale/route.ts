import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { ensureAccountWatcherStarted, generateWithPool } from "@/server/account-service";
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

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            prompt = String(formData.get("prompt") || "Upscale this image").trim();
            model = String(formData.get("model") || "gpt-image-1").trim() || "gpt-image-1";
        } else {
            const body = (await request.json()) as Record<string, unknown>;
            prompt = String(body.prompt || "Upscale this image").trim();
            model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
        }

        // Upscale uses the same generation pipeline.
        // The upstream ChatGPT API does not have a native upscale endpoint,
        // so we generate with an upscale-oriented prompt.
        const result = await generateWithPool(prompt, model, 1);

        return jsonOk(result);
    } catch (error) {
        if (error instanceof ImageGenerationError) {
            return jsonError(new ApiError(502, error.message));
        }
        return jsonError(error);
    }
}
