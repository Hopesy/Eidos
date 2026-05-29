import { NextRequest } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/server/request-validation";
import { jsonOk, jsonError, ApiError } from "@/server/response";
import { resolveApiBase } from "@/server/providers/openai/api-service-shared";

export const runtime = "nodejs";

const TIMEOUT_MS = 15000;

const bodySchema = z.object({
  baseUrl: z.string().trim().min(1, "baseUrl is required"),
  apiKey: z.string().trim().min(1, "apiKey is required"),
});

type TestResult = {
  ok: boolean;
  status?: number;
  endpoint: string;
  durationMs: number;
  message: string;
  hint?: string;
};

export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey } = await parseJsonBody(request, bodySchema);

    let endpoint: string;
    try {
      endpoint = `${resolveApiBase(baseUrl)}/models`;
      // Surface obviously broken URLs early so the caller sees a clear error.
      new URL(endpoint);
    } catch {
      throw new ApiError(400, "图像 API 地址不是合法的 URL");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const startedAt = Date.now();

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
      const durationMs = Date.now() - startedAt;
      const aborted = error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      const result: TestResult = {
        ok: false,
        endpoint,
        durationMs,
        message: aborted
          ? `连接超时（${Math.round(TIMEOUT_MS / 1000)}s）`
          : `无法连接：${error instanceof Error ? error.message : String(error)}`,
        hint: aborted
          ? "检查网络、地址是否可达，或者是否需要启用代理"
          : "请检查地址拼写、协议（http/https），以及代理设置",
      };
      return jsonOk(result);
    }
    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;

    if (response.ok) {
      const result: TestResult = {
        ok: true,
        status: response.status,
        endpoint,
        durationMs,
        message: `连接正常（${response.status}），鉴权通过`,
      };
      return jsonOk(result);
    }

    const bodyPreview = (await response.text().catch(() => "")).slice(0, 200);
    let hint: string | undefined;
    if (response.status === 401 || response.status === 403) {
      hint = "API Key 无效或没有权限";
    } else if (response.status === 404) {
      hint = "地址可达，但未找到 /models 端点。请确认是否为 OpenAI 兼容地址";
    } else if (response.status === 429) {
      hint = "上游限流，稍后重试";
    } else if (response.status >= 500) {
      hint = "上游服务异常";
    }

    const result: TestResult = {
      ok: false,
      status: response.status,
      endpoint,
      durationMs,
      message: bodyPreview ? `HTTP ${response.status}：${bodyPreview}` : `HTTP ${response.status}`,
      hint,
    };
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
