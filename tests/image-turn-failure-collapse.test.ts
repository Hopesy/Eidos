import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyTurnCanceled, applyTurnFailure, applyTurnGenerating, applyTurnSuccess } from "../src/features/image-workbench/turn-patches.ts";
import { buildSharedRecoverableRetryResult, resolveRetrySourceContext } from "../src/features/image-workbench/retry-recover.ts";
import { createResultImage } from "../src/features/image-workbench/utils.ts";
import type { ImageConversationTurn } from "../src/store/image-conversations.ts";

function createTurn(overrides: Partial<ImageConversationTurn> = {}): ImageConversationTurn {
  return {
    id: "turn-1",
    title: "生成",
    mode: "generate",
    prompt: "测试提示词",
    model: "gpt-image-2",
    imageSize: "2048x2048",
    imageQuality: "medium",
    count: 2,
    sourceImages: [],
    images: [
      { id: "turn-1-0", status: "loading" },
      { id: "turn-1-1", status: "loading" },
    ],
    createdAt: "2026-05-05T00:00:00.000Z",
    status: "generating",
    ...overrides,
  };
}

describe("image turn recoverable failures", () => {
  it("keeps retry recovery context while a manual retry is loading", () => {
    const next = applyTurnGenerating(
      createTurn({
        status: "error",
        failureKind: "accepted_pending",
        retryAction: "resume_polling",
        retryable: true,
        stage: "poll",
        upstreamConversationId: "conversation-1",
        sourceAccountId: "account-1",
      }),
      [{ id: "turn-1-0", status: "loading" }],
      {
        failureKind: "accepted_pending",
        retryAction: "resume_polling",
        retryable: true,
        stage: "poll",
        upstreamConversationId: "conversation-1",
        sourceAccountId: "account-1",
      },
    );

    assert.equal(next.status, "generating");
    assert.equal(next.retryAction, "resume_polling");
    assert.equal(next.upstreamConversationId, "conversation-1");
    assert.equal(next.sourceAccountId, "account-1");
  });

  it("preserves recovery source account when a retry-later response omits it", () => {
    const turn = createTurn({
      status: "generating",
      failureKind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: "conversation-1",
      sourceAccountId: "account-1",
      images: [{ id: "turn-1-0", status: "loading", startedAt: 5_000 }],
    });

    const next = applyTurnFailure(turn, "任务仍在处理中", {
      failureKind: "accepted_pending",
      retryAction: "resume_polling",
      retryable: true,
      stage: "poll",
      upstreamConversationId: "conversation-1",
    }, [0]);

    assert.equal(next.status, "error");
    assert.equal(next.retryAction, "resume_polling");
    assert.equal(next.sourceAccountId, "account-1");
    assert.equal(next.images[0]?.sourceAccountId, "account-1");
  });

  it("preserves per-image durations when multi-image results settle at different times", () => {
    const originalNow = Date.now;
    Date.now = () => 20_000;
    try {
      const next = applyTurnSuccess(
        createTurn({
          images: [
            { id: "turn-1-0", status: "loading", startedAt: 5_000 },
            { id: "turn-1-1", status: "loading", startedAt: 12_000 },
          ],
        }),
        [
          { id: "turn-1-0", status: "success", b64_json: "ZmFrZS0w", durationMs: 7_000 },
          { id: "turn-1-1", status: "success", b64_json: "ZmFrZS0x" },
        ],
        0,
        15_000,
      );

      assert.equal(next.durationMs, 15_000);
      assert.equal(next.images[0]?.durationMs, 7_000);
      assert.equal(next.images[1]?.durationMs, 8_000);
    } finally {
      Date.now = originalNow;
    }
  });

  it("collapses shared recoverable multi-image failures into a single error card", () => {
    const turn = createTurn();

    const next = applyTurnFailure(turn, "图片结果已就绪，但下载失败。", {
      failureKind: "result_fetch_failed",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: "conversation-1",
      fileIds: ["file-a", "file-b"],
    });

    assert.equal(next.images.length, 1);
    assert.equal(next.images[0]?.status, "error");
    assert.equal(next.retryAction, "retry_download");
    assert.deepEqual(next.fileIds, ["file-a", "file-b"]);
  });

  it("keeps remaining downloads as one shared failure item after partial recovery", () => {
    const turn = createTurn({
      images: [{ id: "turn-1-0", status: "error", error: "图片结果已就绪，但下载失败。" }],
      status: "error",
      retryAction: "retry_download",
      retryable: true,
      stage: "download",
      upstreamConversationId: "conversation-1",
      upstreamParentMessageId: "parent-1",
      sourceAccountId: "account-1",
      fileIds: ["file-a", "file-b"],
    });

    const result = buildSharedRecoverableRetryResult(turn, [
      {
        b64_json: "ZmFrZS1wbmc=",
        file_id: "file-a",
      },
    ]);

    assert.equal(result.images.length, 2);
    assert.equal(result.images[0]?.status, "success");
    assert.equal(result.images[1]?.status, "error");
    assert.equal(result.images[1]?.upstreamConversationId, "conversation-1");
    assert.equal(result.images[1]?.upstreamParentMessageId, "parent-1");
    assert.equal(result.images[1]?.sourceAccountId, "account-1");
    assert.deepEqual(result.images[1]?.fileIds, ["file-b"]);
    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.remainingFileIds, ["file-b"]);
  });

  it("cancels only the requested loading image during retry fallback", () => {
    const originalNow = Date.now;
    Date.now = () => 20_000;
    try {
      const turn = createTurn({
        images: [
          { id: "turn-1-0", status: "success", b64_json: "ZmFrZQ==" },
          { id: "turn-1-1", status: "loading", startedAt: 5_000 },
        ],
      });

      const next = applyTurnCanceled(turn, [1]);

      assert.equal(next.status, "error");
      assert.equal(next.images[0]?.status, "success");
      assert.equal(next.images[1]?.status, "error");
      assert.equal(next.images[1]?.error, "已取消生成");
      assert.equal(next.images[1]?.durationMs, 15_000);
    } finally {
      Date.now = originalNow;
    }
  });

  it("preserves image-level upstream context for later card retry", () => {
    const image = createResultImage("image-a", {
      b64_json: "ZmFrZQ==",
      conversation_id: "image-conversation",
      parent_message_id: "image-parent",
      source_account_id: "image-account",
      response_id: "image-response",
      image_generation_call_id: "image-call",
    });

    assert.equal(image.upstreamConversationId, "image-conversation");
    assert.equal(image.upstreamParentMessageId, "image-parent");
    assert.equal(image.sourceAccountId, "image-account");
    assert.equal(image.upstreamResponseId, "image-response");
    assert.equal(image.imageGenerationCallId, "image-call");
  });

  it("does not borrow turn-level upstream context when retrying an individual card", () => {
    const turn = createTurn({
      upstreamConversationId: "turn-conversation",
      upstreamParentMessageId: "turn-parent",
      sourceAccountId: "turn-account",
      images: [
        {
          id: "image-a",
          status: "error",
          error: "失败",
          conversation_id: "image-conversation",
          parent_message_id: "image-parent",
          source_account_id: "image-account",
        },
        {
          id: "image-b",
          status: "error",
          error: "失败",
        },
      ],
    });

    assert.deepEqual(resolveRetrySourceContext(turn, turn.images[0]!), {
      upstreamConversationId: "image-conversation",
      upstreamParentMessageId: "image-parent",
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: "image-account",
      fileIds: undefined,
    });
    assert.deepEqual(resolveRetrySourceContext(turn, turn.images[1]!), {
      upstreamConversationId: undefined,
      upstreamParentMessageId: undefined,
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: undefined,
      fileIds: undefined,
    });
  });
});
