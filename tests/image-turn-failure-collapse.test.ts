import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyTurnFailure } from "../src/features/image-workbench/turn-patches.ts";
import { buildSharedRecoverableRetryResult } from "../src/features/image-workbench/retry-recover.ts";
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
    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.remainingFileIds, ["file-b"]);
  });
});
