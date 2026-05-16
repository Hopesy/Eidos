import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHttpImageError,
  createImageError,
  getImageErrorMeta,
  ImageGenerationError,
  isAccountBlockedMessage,
  isApiServiceUnavailableMessage,
  isInputBlockedMessage,
  normalizeUpstreamErrorMessage,
} from "../src/server/providers/openai/image-errors.ts";
import { resolveImageErrorStatus } from "../src/server/image/error-status.ts";

describe("openai image error policy", () => {
  it("normalizes structured upstream content policy errors", () => {
    const message = normalizeUpstreamErrorMessage(JSON.stringify({
      error: {
        code: "content_policy_violation",
        message: "blocked by policy",
      },
    }));

    assert.equal(message, "内容审核拦截：blocked by policy");
  });

  it("classifies input and account blocked messages", () => {
    assert.equal(isInputBlockedMessage("content policy violation"), true);
    assert.equal(isInputBlockedMessage("抱歉，我无法生成该内容"), true);
    assert.equal(
      isInputBlockedMessage("非常抱歉，生成的图片可能违反了关于潜在欺诈或诈骗活动的防护限制。如果你认为此判断有误，请重试或修改提示语。"),
      true,
    );
    assert.equal(isInputBlockedMessage("<!DOCTYPE html><html><head><title>Just a moment...</title><meta http-equiv=\"content-security-policy\"></head></html>"), false);
    assert.equal(isAccountBlockedMessage("token_invalidated"), true);
    assert.equal(isAccountBlockedMessage("HTTP 429 quota exceeded"), true);
    assert.equal(isApiServiceUnavailableMessage("<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>"), true);
  });

  it("maps HTTP status to retry semantics", () => {
    const unauthorized = buildHttpImageError("unauthorized", 401, "submit");
    assert.equal(unauthorized.kind, "account_blocked");
    assert.equal(unauthorized.retryAction, "switch_account");
    assert.equal(unauthorized.retryable, true);

    const apiUnauthorized = buildHttpImageError("bad key", 401, "api_service");
    assert.equal(apiUnauthorized.kind, "account_blocked");
    assert.equal(apiUnauthorized.retryAction, "none");
    assert.equal(apiUnauthorized.retryable, false);

    const blocked = buildHttpImageError("bad request", 400, "submit");
    assert.equal(blocked.kind, "input_blocked");
    assert.equal(blocked.retryAction, "revise_input");
    assert.equal(blocked.retryable, false);

    const transient = buildHttpImageError("upstream down", 503, "submit");
    assert.equal(transient.kind, "submit_failed");
    assert.equal(transient.retryAction, "resubmit");
    assert.equal(transient.retryable, true);

    const apiTransient = buildHttpImageError("upstream down", 503, "api_service");
    assert.equal(apiTransient.kind, "service_unavailable");
    assert.equal(apiTransient.retryAction, "resubmit");
    assert.equal(apiTransient.retryable, true);
  });

  it("classifies API service gateway blocks separately from prompt blocks", () => {
    const cloudflareHtml = "<!DOCTYPE html><html lang=\"en-US\"><head><title>Just a moment...</title><meta http-equiv=\"content-security-policy\" content=\"default-src 'none'\"></head></html>";
    const gatewayBlocked = buildHttpImageError(cloudflareHtml, 403, "api_service");
    assert.equal(gatewayBlocked.kind, "service_unavailable");
    assert.equal(gatewayBlocked.retryAction, "resubmit");
    assert.equal(gatewayBlocked.retryable, true);
    assert.equal(gatewayBlocked.statusCode, 403);
    assert.match(gatewayBlocked.message, /图像 API 服务暂时不可用/);

    const policyBlocked = buildHttpImageError(JSON.stringify({
      error: {
        code: "content_policy_violation",
        message: "blocked by policy",
      },
    }), 403, "api_service");
    assert.equal(policyBlocked.kind, "input_blocked");
    assert.equal(policyBlocked.retryAction, "revise_input");
    assert.equal(policyBlocked.retryable, false);
  });

  it("exposes stable image error metadata", () => {
    const error = createImageError("rate limited", {
      kind: "poll_rate_limited",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      statusCode: 429,
      upstreamConversationId: "conv-1",
      fileIds: ["file-1"],
      lastPollStatus: 429,
      pollStatusCounts: { "429": 3 },
      pollAttempts: 3,
      retryAfterMs: 5000,
      upstreamBodyPreview: "rate limited",
    });

    assert.ok(error instanceof ImageGenerationError);
    assert.deepEqual(getImageErrorMeta(error), {
      failureKind: "poll_rate_limited",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: "conv-1",
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: undefined,
      fileIds: ["file-1"],
      statusCode: 429,
      lastPollStatus: 429,
      pollStatusCounts: { "429": 3 },
      pollAttempts: 3,
      retryAfterMs: 5000,
      upstreamBodyPreview: "rate limited",
    });
    assert.deepEqual(getImageErrorMeta(new Error("plain")), {});
  });

  it("maps accepted pending work to a non-5xx retry-later response", () => {
    const error = createImageError("pending", {
      kind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
    });

    assert.equal(resolveImageErrorStatus(error), 425);
  });

  it("maps poll rate limits to HTTP 429 with retry metadata", () => {
    const error = createImageError("rate limited", {
      kind: "poll_rate_limited",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      lastPollStatus: 429,
    });

    assert.equal(resolveImageErrorStatus(error), 429);
  });
});
