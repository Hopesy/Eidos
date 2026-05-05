import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RecoverableImageTaskItem } from "../src/lib/api/types/index.ts";
import type { ImageConversationTurn } from "../src/store/image-conversations.ts";
import { findRecoverableTaskForTurn, mergeRecoverableTaskIntoTurn } from "../src/features/image-workbench/recovery-candidates.ts";

function createTurn(overrides: Partial<ImageConversationTurn> = {}): ImageConversationTurn {
  return {
    id: "turn-1",
    title: "生成",
    mode: "generate",
    prompt: "原始提示词",
    model: "gpt-image-2",
    imageSize: "2048x2048",
    imageQuality: "medium",
    count: 1,
    sourceImages: [],
    images: [{ id: "image-1", status: "error", error: "下载失败" }],
    createdAt: "2026-05-04T00:00:00.000Z",
    status: "error",
    error: "图片结果已就绪，但下载失败。",
    ...overrides,
  };
}

function createTask(overrides: Partial<RecoverableImageTaskItem> = {}): RecoverableImageTaskItem {
  return {
    id: "task-1",
    localConversationId: "conversation-1",
    localTurnId: "turn-1",
    mode: "generate",
    status: "failed",
    failureKind: "result_fetch_failed",
    retryAction: "retry_download",
    retryable: true,
    stage: "download",
    upstreamConversationId: "upstream-conversation-1",
    upstreamResponseId: null,
    imageGenerationCallId: null,
    sourceAccountId: "account-1",
    fileIds: ["file-1"],
    revisedPrompt: "修订提示词",
    model: "gpt-image-2",
    prompt: "修订提示词",
    error: "图片结果已就绪，但下载失败。",
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:01:00.000Z",
    ...overrides,
  };
}

describe("image recovery candidate helpers", () => {
  it("finds the recoverable upstream task for a specific turn", () => {
    const turn = createTurn();
    const task = createTask();

    const matched = findRecoverableTaskForTurn([task], "conversation-1", turn);

    assert.equal(matched?.id, "task-1");
  });

  it("merges upstream recovery metadata into the stored turn for manual retry", () => {
    const turn = createTurn({
      retryAction: undefined,
      retryable: undefined,
      sourceAccountId: undefined,
      upstreamConversationId: undefined,
      fileIds: undefined,
    });
    const task = createTask();

    const merged = mergeRecoverableTaskIntoTurn(turn, task);

    assert.equal(merged.retryAction, "retry_download");
    assert.equal(merged.retryable, true);
    assert.equal(merged.sourceAccountId, "account-1");
    assert.equal(merged.upstreamConversationId, "upstream-conversation-1");
    assert.deepEqual(merged.fileIds, ["file-1"]);
    assert.equal(merged.prompt, "修订提示词");
  });
});
