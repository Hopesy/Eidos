import {
  ImageGenerationError,
} from "@/server/providers/openai-client";

export const API_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 1500;

export function isRetryableApiError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "retry_download");
  }
  const normalized = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("content policy") ||
    normalized.includes("safety") ||
    normalized.includes("policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("bad request") ||
    normalized.includes("400") ||
    normalized.includes("401") ||
    normalized.includes("403")
  ) {
    return false;
  }
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network error") ||
    normalized.includes("request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("terminated") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("und_err") ||
    normalized.includes("socket") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("service unavailable")
  );
}

export function getApiRetryDelayMs(attempt: number, error: unknown) {
  const normalizedAttempt = Math.max(1, attempt);
  if (error instanceof ImageGenerationError) {
    if (error.statusCode === 429) {
      return 4000 * normalizedAttempt;
    }
    if (error.stage === "upload") {
      return 1200 * normalizedAttempt;
    }
    if (error.stage === "api_service" || error.stage === "submit") {
      return API_RETRY_BASE_DELAY_MS * (2 ** (normalizedAttempt - 1));
    }
  }
  return API_RETRY_BASE_DELAY_MS * (2 ** (normalizedAttempt - 1));
}

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
