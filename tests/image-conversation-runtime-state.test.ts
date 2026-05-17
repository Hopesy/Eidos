import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeConversationRuntimeState } from "../src/features/image-workbench/utils.ts";
import { finishImageTask, listActiveImageTasks, startImageTask } from "../src/store/image-active-tasks.ts";
import type { ImageConversation } from "../src/store/image-conversations.ts";

function createConversation(overrides: Partial<ImageConversation> = {}): ImageConversation {
  return {
    id: "conversation-1",
    title: "生成",
    mode: "generate",
    prompt: "测试提示词",
    model: "gpt-image-2",
    imageSize: "2048x2048",
    imageQuality: "medium",
    count: 2,
    sourceImages: [],
    images: [],
    turns: [
      {
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
          { id: "turn-1-0", status: "success", b64_json: "ZmFrZQ==" },
          { id: "turn-1-1", status: "loading", startedAt: 50_000 },
        ],
        createdAt: "2026-05-13T05:19:51.408Z",
        status: "generating",
      },
    ],
    createdAt: "2026-05-13T05:19:51.408Z",
    status: "generating",
    ...overrides,
  };
}

describe("image conversation runtime state normalization", () => {
  it("archives stale loading images when no runtime task is active", () => {
    const originalNow = Date.now;
    Date.now = () => 200_000;
    try {
      const result = normalizeConversationRuntimeState([createConversation()]);
      const conversation = result.items[0]!;
      const turn = conversation.turns![0]!;

      assert.equal(result.changed, true);
      assert.equal(conversation.status, "error");
      assert.equal(turn.status, "error");
      assert.equal(turn.error, "任务已中断");
      assert.equal(turn.images[0]?.status, "success");
      assert.equal(turn.images[1]?.status, "error");
      assert.equal(turn.images[1]?.error, "页面已刷新，任务已中断");
      assert.equal(turn.images[1]?.durationMs, 150_000);
    } finally {
      Date.now = originalNow;
    }
  });

  it("keeps currently active runtime tasks in generating state", () => {
    const conversation = createConversation({
      id: "conversation-live",
      turns: [
        {
          ...createConversation().turns![0]!,
          id: "turn-live",
        },
      ],
    });
    startImageTask({
      conversationId: "conversation-live",
      turnId: "turn-live",
      mode: "generate",
      count: 2,
      variant: "standard",
      startedAt: 50_000,
    });
    try {
      const result = normalizeConversationRuntimeState([conversation]);
      const turn = result.items[0]!.turns![0]!;

      assert.equal(result.changed, false);
      assert.equal(result.items[0]!.status, "generating");
      assert.equal(turn.status, "generating");
      assert.equal(turn.images[1]?.status, "loading");
    } finally {
      finishImageTask("conversation-live", "turn-live");
    }
  });

  it("keeps a turn active until overlapping runtime tasks all finish", () => {
    const conversation = createConversation({
      id: "conversation-overlap",
      turns: [
        {
          ...createConversation().turns![0]!,
          id: "turn-overlap",
        },
      ],
    });
    startImageTask({
      conversationId: "conversation-overlap",
      turnId: "turn-overlap",
      mode: "generate",
      count: 1,
      variant: "standard",
      startedAt: 50_000,
    });
    startImageTask({
      conversationId: "conversation-overlap",
      turnId: "turn-overlap",
      mode: "generate",
      count: 1,
      variant: "standard",
      startedAt: 60_000,
    });
    try {
      finishImageTask("conversation-overlap", "turn-overlap");

      const result = normalizeConversationRuntimeState([conversation]);
      const turn = result.items[0]!.turns![0]!;

      assert.equal(result.changed, false);
      assert.equal(result.items[0]!.status, "generating");
      assert.equal(turn.status, "generating");
      assert.equal(turn.images[1]?.status, "loading");
    } finally {
      finishImageTask("conversation-overlap", "turn-overlap");
    }
  });

  it("tracks concurrent retry cards in the same turn as independent tasks", () => {
    const conversation = createConversation({
      id: "conversation-retry-overlap",
      turns: [
        {
          ...createConversation().turns![0]!,
          id: "turn-retry-overlap",
          images: [
            { id: "image-a", status: "loading", startedAt: 50_000 },
            { id: "image-b", status: "loading", startedAt: 60_000 },
          ],
        },
      ],
    });

    startImageTask({
      taskId: "retry-image-a",
      conversationId: "conversation-retry-overlap",
      turnId: "turn-retry-overlap",
      imageIds: ["image-a"],
      mode: "generate",
      count: 1,
      variant: "standard",
      startedAt: 50_000,
    });
    startImageTask({
      taskId: "retry-image-b",
      conversationId: "conversation-retry-overlap",
      turnId: "turn-retry-overlap",
      imageIds: ["image-b"],
      mode: "generate",
      count: 1,
      variant: "standard",
      startedAt: 60_000,
    });

    try {
      assert.equal(
        listActiveImageTasks().filter((task) => task.conversationId === "conversation-retry-overlap").length,
        2,
      );

      finishImageTask("conversation-retry-overlap", "turn-retry-overlap", "retry-image-a");

      const result = normalizeConversationRuntimeState([conversation]);
      const turn = result.items[0]!.turns![0]!;

      assert.equal(
        listActiveImageTasks().filter((task) => task.conversationId === "conversation-retry-overlap").length,
        1,
      );
      assert.equal(result.changed, false);
      assert.equal(result.items[0]!.status, "generating");
      assert.equal(turn.status, "generating");
      assert.equal(turn.images[0]?.status, "loading");
      assert.equal(turn.images[1]?.status, "loading");
    } finally {
      finishImageTask("conversation-retry-overlap", "turn-retry-overlap", "retry-image-a");
      finishImageTask("conversation-retry-overlap", "turn-retry-overlap", "retry-image-b");
    }
  });

  it("repairs stale conversation-level generating status from settled turns", () => {
    const result = normalizeConversationRuntimeState([
      createConversation({
        status: "generating",
        turns: [
          {
            ...createConversation().turns![0]!,
            status: "success",
            images: [{ id: "turn-1-0", status: "success", b64_json: "ZmFrZQ==" }],
          },
        ],
      }),
    ]);

    assert.equal(result.changed, true);
    assert.equal(result.items[0]!.status, "success");
  });
});
