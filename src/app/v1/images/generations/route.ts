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
    const body = (await request.json()) as {
      prompt?: string;
      model?: string;
      n?: number;
    };
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      throw new ApiError(400, "prompt is required");
    }
    const model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
    const count = Number.isInteger(body.n) ? Number(body.n) : 1;
    if (count < 1 || count > 4) {
      throw new ApiError(400, "n must be between 1 and 4");
    }
    return jsonOk(await generateWithPool(prompt, model, count));
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return jsonError(new ApiError(502, error.message));
    }
    return jsonError(error);
  }
}
