import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHttpImageError,
  createImageError,
  getImageErrorMeta,
  ImageGenerationError,
  isAccountBlockedMessage,
  isInputBlockedMessage,
  normalizeUpstreamErrorMessage,
} from "../src/server/providers/openai-image-errors.ts";

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
    assert.equal(isAccountBlockedMessage("token_invalidated"), true);
    assert.equal(isAccountBlockedMessage("HTTP 429 quota exceeded"), true);
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
  });

  it("exposes stable image error metadata", () => {
    const error = createImageError("pending", {
      kind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: "conv-1",
      fileIds: ["file-1"],
    });

    assert.ok(error instanceof ImageGenerationError);
    assert.deepEqual(getImageErrorMeta(error), {
      failureKind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: "conv-1",
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: undefined,
      fileIds: ["file-1"],
    });
    assert.deepEqual(getImageErrorMeta(new Error("plain")), {});
  });
});
