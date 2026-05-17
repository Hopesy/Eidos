function cleanToken(value: unknown) {
  return String(value || "").trim();
}
export type ImageFailureKind =
  | "submit_failed"
  | "accepted_pending"
  | "poll_rate_limited"
  | "source_invalid"
  | "result_fetch_failed"
  | "service_unavailable"
  | "account_blocked"
  | "input_blocked"
  | "unknown";

export type ImageRetryAction = "resubmit" | "resume_polling" | "retry_download" | "switch_account" | "revise_input" | "none";

export type ImagePipelineStage =
  | "validation"
  | "account"
  | "upload"
  | "submit"
  | "poll"
  | "download"
  | "api_service"
  | "unknown";

export type ImageGenerationErrorOptions = {
  kind?: ImageFailureKind;
  retryAction?: ImageRetryAction;
  retryable?: boolean;
  stage?: ImagePipelineStage;
  statusCode?: number;
  upstreamConversationId?: string;
  upstreamParentMessageId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
  lastPollStatus?: number;
  pollStatusCounts?: Record<string, number>;
  pollAttempts?: number;
  retryAfterMs?: number;
  upstreamBodyPreview?: string;
};

export class ImageGenerationError extends Error {
  kind: ImageFailureKind;
  retryAction: ImageRetryAction;
  retryable: boolean;
  stage: ImagePipelineStage;
  statusCode?: number;
  upstreamConversationId?: string;
  upstreamParentMessageId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
  lastPollStatus?: number;
  pollStatusCounts?: Record<string, number>;
  pollAttempts?: number;
  retryAfterMs?: number;
  upstreamBodyPreview?: string;

  constructor(message: string, options: ImageGenerationErrorOptions = {}) {
    super(message);
    this.name = "ImageGenerationError";
    this.kind = options.kind ?? "unknown";
    this.retryAction = options.retryAction ?? "none";
    this.retryable = options.retryable ?? false;
    this.stage = options.stage ?? "unknown";
    this.statusCode = options.statusCode;
    this.upstreamConversationId = options.upstreamConversationId;
    this.upstreamParentMessageId = options.upstreamParentMessageId;
    this.upstreamResponseId = options.upstreamResponseId;
    this.imageGenerationCallId = options.imageGenerationCallId;
    this.sourceAccountId = options.sourceAccountId;
    this.fileIds = options.fileIds;
    this.lastPollStatus = options.lastPollStatus;
    this.pollStatusCounts = options.pollStatusCounts;
    this.pollAttempts = options.pollAttempts;
    this.retryAfterMs = options.retryAfterMs;
    this.upstreamBodyPreview = options.upstreamBodyPreview;
  }
}

export function createImageError(message: string, options: ImageGenerationErrorOptions = {}) {
  return new ImageGenerationError(message, options);
}

function parseUpstreamErrorPayload(raw: string) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const nestedError =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : payload;
    const message = cleanToken(nestedError.message || payload.message || payload.error);
    const code = cleanToken(nestedError.code || payload.code);
    const type = cleanToken(nestedError.type || payload.type);
    if (!message && !code && !type) {
      return null;
    }
    return {
      message,
      code,
      type,
    };
  } catch {
    return null;
  }
}

export function normalizeUpstreamErrorMessage(raw: string) {
  const parsed = parseUpstreamErrorPayload(raw);
  if (!parsed) {
    return String(raw || "").trim();
  }

  if (parsed.code === "content_policy_violation" && parsed.message) {
    return `内容审核拦截：${parsed.message}`;
  }

  return parsed.message || parsed.code || parsed.type || String(raw || "").trim();
}

export function isApiServiceUnavailableMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("<!doctype html") ||
    normalized.includes("<html") ||
    normalized.includes("</html>") ||
    normalized.includes("<head>") ||
    normalized.includes("<body") ||
    normalized.includes("just a moment") ||
    normalized.includes("cloudflare") ||
    normalized.includes("cf-ray") ||
    normalized.includes("captcha") ||
    normalized.includes("bad gateway") ||
    normalized.includes("gateway timeout") ||
    normalized.includes("service unavailable") ||
    normalized.includes("origin is unreachable")
  );
}

export function isInputBlockedMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  if (isApiServiceUnavailableMessage(normalized)) {
    return false;
  }
  return (
    normalized.includes("content policy") ||
    normalized.includes("content_policy_violation") ||
    normalized.includes("内容审核拦截") ||
    normalized.includes("safety system") ||
    normalized.includes("violates our") ||
    normalized.includes("violation of policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("invalid image") ||
    normalized.includes("cannot generate") ||
    normalized.includes("unable to generate") ||
    normalized.includes("抱歉，我不能") ||
    normalized.includes("抱歉，我无法") ||
    normalized.includes("无法生成") ||
    normalized.includes("不能生成") ||
    normalized.includes("可能违反") ||
    normalized.includes("防护限制") ||
    normalized.includes("修改提示词") ||
    normalized.includes("修改提示语") ||
    normalized.includes("欺诈") ||
    normalized.includes("诈骗") ||
    normalized.includes("性暗示") ||
    normalized.includes("色情")
  );
}

export function isAccountBlockedMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("token_invalidated") ||
    normalized.includes("token_revoked") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("invalidated oauth token") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("429") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized")
  );
}

const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

export function parseRetryAfterHeader(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return undefined;
  }
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000));
  }
  const retryDate = Date.parse(normalized);
  if (!Number.isNaN(retryDate)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, retryDate - Date.now()));
  }
  return undefined;
}

export function buildHttpImageError(
  message: string,
  status: number,
  stage: ImagePipelineStage,
  fallbackKind: ImageFailureKind = "submit_failed",
  options: { retryAfterMs?: number } = {},
) {
  const normalizedMessage = normalizeUpstreamErrorMessage(message);
  const isApiServiceStage = stage === "api_service";
  const inputBlocked = isInputBlockedMessage(normalizedMessage);
  const retryAfterMs = options.retryAfterMs;
  if (status === 401 || status === 429) {
    if (isApiServiceStage && status === 401) {
      return createImageError(`图像 API 认证失败：${normalizedMessage}`, {
        kind: "account_blocked",
        retryAction: "none",
        retryable: false,
        stage,
        statusCode: status,
      });
    }
    if (isApiServiceStage && status === 429) {
      return createImageError(`图像 API 限流：${normalizedMessage}`, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage,
        statusCode: status,
        retryAfterMs,
      });
    }
    return createImageError(normalizedMessage, {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: true,
      stage,
      statusCode: status,
      retryAfterMs,
    });
  }
  if (isApiServiceStage && isApiServiceUnavailableMessage(normalizedMessage)) {
    return createImageError("图像 API 服务暂时不可用：上游网关返回了不可用页面或拦截页", {
      kind: "service_unavailable",
      retryAction: "resubmit",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  if (status === 400 || inputBlocked || (!isApiServiceStage && status === 403)) {
    return createImageError(normalizedMessage, {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage,
      statusCode: status,
    });
  }
  if (isApiServiceStage && status === 403) {
    return createImageError(
      `图像 API 服务拒绝访问，请检查 API key 与 baseUrl 配置：${normalizedMessage}`,
      {
        kind: "account_blocked",
        retryAction: "none",
        retryable: false,
        stage,
        statusCode: status,
      },
    );
  }
  if (isApiServiceStage && status >= 500) {
    return createImageError(normalizedMessage || "图像 API 服务暂时不可用", {
      kind: "service_unavailable",
      retryAction: "resubmit",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  if (status >= 500) {
    return createImageError(normalizedMessage, {
      kind: fallbackKind,
      retryAction: "resubmit",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  return createImageError(normalizedMessage, {
    kind: fallbackKind,
    retryAction: "resubmit",
    retryable: fallbackKind === "submit_failed",
    stage,
    statusCode: status,
  });
}

export function getImageErrorMeta(error: unknown) {
  if (!(error instanceof ImageGenerationError)) {
    return {};
  }
  return {
    failureKind: error.kind,
    retryAction: error.retryAction,
    retryable: error.retryable,
    stage: error.stage,
    upstreamConversationId: error.upstreamConversationId,
    upstreamParentMessageId: error.upstreamParentMessageId,
    upstreamResponseId: error.upstreamResponseId,
    imageGenerationCallId: error.imageGenerationCallId,
    sourceAccountId: error.sourceAccountId,
    fileIds: error.fileIds,
    statusCode: error.statusCode,
    lastPollStatus: error.lastPollStatus,
    pollStatusCounts: error.pollStatusCounts,
    pollAttempts: error.pollAttempts,
    retryAfterMs: error.retryAfterMs,
    upstreamBodyPreview: error.upstreamBodyPreview,
  };
}


