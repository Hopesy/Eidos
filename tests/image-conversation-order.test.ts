import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getImageConversationActivityAt,
  sortImageConversationsByActivity,
} from "../src/shared/image-conversation-order.ts";

describe("image conversation ordering", () => {
  it("uses the newest turn timestamp as conversation activity", () => {
    const conversation = {
      id: "conversation-old",
      createdAt: "2026-05-01T00:00:00.000Z",
      turns: [
        { createdAt: "2026-05-01T00:00:00.000Z" },
        { createdAt: "2026-05-03T00:00:00.000Z" },
      ],
    };

    assert.equal(getImageConversationActivityAt(conversation), "2026-05-03T00:00:00.000Z");
  });

  it("moves an older conversation ahead after a new turn is appended", () => {
    const oldConversationWithNewTurn = {
      id: "conversation-a",
      createdAt: "2026-05-01T00:00:00.000Z",
      turns: [
        { createdAt: "2026-05-01T00:00:00.000Z" },
        { createdAt: "2026-05-04T00:00:00.000Z" },
      ],
    };
    const newerTopLevelConversation = {
      id: "conversation-b",
      createdAt: "2026-05-03T00:00:00.000Z",
      turns: [
        { createdAt: "2026-05-03T00:00:00.000Z" },
      ],
    };

    const sorted = sortImageConversationsByActivity([
      newerTopLevelConversation,
      oldConversationWithNewTurn,
    ]);

    assert.deepEqual(sorted.map((item) => item.id), ["conversation-a", "conversation-b"]);
  });
});
