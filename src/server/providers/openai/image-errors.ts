function cleanToken(value: unknown) {
  return String(value || "").trim();
}
export type ImageFailureKind =
  | "submit_failed"
  | "accepted_pending"
  | "source_invalid"
  | "result_fetch_failed"
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
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
};

export class ImageGenerationError extends Error {
  kind: ImageFailureKind;
  retryAction: ImageRetryAction;
  retryable: boolean;
  stage: ImagePipelineStage;
  statusCode?: number;
  upstreamConversationId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];

  constructor(message: string, options: ImageGenerationErrorOptions = {}) {
    super(message);
    this.name = "ImageGenerationError";
    this.kind = options.kind ?? "unknown";
    this.retryAction = options.retryAction ?? "none";
    this.retryable = options.retryable ?? false;
    this.stage = options.stage ?? "unknown";
    this.statusCode = options.statusCode;
    this.upstreamConversationId = options.upstreamConversationId;
    this.upstreamResponseId = options.upstreamResponseId;
    this.imageGenerationCallId = options.imageGenerationCallId;
    this.sourceAccountId = options.sourceAccountId;
    this.fileIds = options.fileIds;
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

export function isInputBlockedMessage(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("content policy") ||
    normalized.includes("content_policy_violation") ||
    normalized.includes("safety") ||
    normalized.includes("policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("bad request") ||
    normalized.includes("cannot generate") ||
    normalized.includes("unable to generate") ||
    normalized.includes("抱歉，我不能") ||
    normalized.includes("抱歉，我无法") ||
    normalized.includes("无法生成") ||
    normalized.includes("不能生成") ||
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

export function buildHttpImageError(message: string, status: number, stage: ImagePipelineStage, fallbackKind: ImageFailureKind = "submit_failed") {
  const normalizedMessage = normalizeUpstreamErrorMessage(message);
  const isApiServiceStage = stage === "api_service";
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
      });
    }
    return createImageError(normalizedMessage, {
      kind: "account_blocked",
      retryAction: "switch_account",
      retryable: true,
      stage,
      statusCode: status,
    });
  }
  if (status === 400 || status === 403 || isInputBlockedMessage(normalizedMessage)) {
    return createImageError(normalizedMessage, {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
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
    upstreamResponseId: error.upstreamResponseId,
    imageGenerationCallId: error.imageGenerationCallId,
    sourceAccountId: error.sourceAccountId,
    fileIds: error.fileIds,
  };
}


