import { NextRequest } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/server/request-validation";
import { ApiError, jsonError, jsonOk } from "@/server/response";
import { cleanToken, resolveApiBase } from "@/server/providers/openai/api-service-shared";

export const runtime = "nodejs";

const TIMEOUT_MS = 15000;

const bodySchema = z.object({
  baseUrl: z.string().trim().min(1, "baseUrl is required"),
  apiKey: z.string().trim().min(1, "apiKey is required"),
});

type ModelListItem = Record<string, unknown> & {
  id: string;
  object: string;
};

function normalizeModelItem(item: unknown): ModelListItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  const id = cleanToken(record.id);
  if (!id) {
    return null;
  }
  return {
    ...record,
    id,
    object: cleanToken(record.object) || "model",
  };
}

export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey } = await parseJsonBody(request, bodySchema);

    let endpoint: string;
    try {
      endpoint = `${resolveApiBase(baseUrl)}/models`;
      new URL(endpoint);
    } catch {
      throw new ApiError(400, "图像 API 地址不是合法的 URL");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      throw new ApiError(
        502,
        aborted ? `拉取模型列表超时（${Math.round(TIMEOUT_MS / 1000)}s）` : `拉取模型列表失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const bodyPreview = (await response.text().catch(() => "")).slice(0, 200);
      throw new ApiError(
        response.status,
        bodyPreview ? `上游 /models 返回 HTTP ${response.status}：${bodyPreview}` : `上游 /models 返回 HTTP ${response.status}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as { data?: unknown[] } | null;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const models = data
      .map(normalizeModelItem)
      .filter((item): item is ModelListItem => Boolean(item));

    return jsonOk({
      object: "list",
      data: models,
    });
  } catch (error) {
    return jsonError(error);
  }
}
