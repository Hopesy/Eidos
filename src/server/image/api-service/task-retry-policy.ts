import {
  ImageGenerationError,
} from "@/server/providers/openai-client";
import { abortableDelay } from "@/server/image/abort";

export const API_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 1500;
const RATE_LIMIT_FLOOR_MS = 15000;
const RATE_LIMIT_MAX_MS = 60000;

export function isRetryableApiError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    if (error.kind === "poll_rate_limited") {
      return false;
    }
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "retry_download");
  }
  const normalized = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("content policy") ||
    normalized.includes("content_policy_violation") ||
    normalized.includes("safety system") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("invalid image") ||
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
      if (typeof error.retryAfterMs === "number" && error.retryAfterMs > 0) {
        return Math.min(RATE_LIMIT_MAX_MS, Math.max(RATE_LIMIT_FLOOR_MS, error.retryAfterMs));
      }
      const escalated = RATE_LIMIT_FLOOR_MS * (2 ** (normalizedAttempt - 1));
      return Math.min(RATE_LIMIT_MAX_MS, escalated);
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

export async function delay(ms: number, signal?: AbortSignal) {
  await abortableDelay(ms, signal);
}
