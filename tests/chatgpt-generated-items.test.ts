import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectGeneratedItems } from "../src/server/providers/chatgpt/generated-items.ts";
import { ImageGenerationError } from "../src/server/providers/openai/image-errors.ts";

describe("chatgpt generated item collection", () => {
  it("retries transient download failures before succeeding", async () => {
    let downloadUrlCalls = 0;
    let imageDownloadCalls = 0;
    const session = {
      async fetch(url: string) {
        if (url.includes("/attachment/")) {
          downloadUrlCalls += 1;
          return new Response(JSON.stringify({ download_url: "https://download.local/file.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/file.png") {
          imageDownloadCalls += 1;
          if (imageDownloadCalls < 3) {
            throw new Error("socket hang up");
          }
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-retry","message":{"content":{"content_type":"text","parts":["sediment://file_1"]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(downloadUrlCalls, 3);
    assert.equal(imageDownloadCalls, 3);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_1");
  });

  it("classifies polling network failures as recoverable pending work", async () => {
    const session = {
      async fetch() {
        throw new Error("network error: fetch failed");
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-pending","message":{"content":{"content_type":"text","parts":["still rendering"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.message, "network error: fetch failed");
        assert.equal(error.kind, "accepted_pending");
        assert.equal(error.retryAction, "resume_polling");
        assert.equal(error.stage, "poll");
        assert.equal(error.upstreamConversationId, "conv-pending");
        return true;
      },
    );
  });

  it("short-circuits policy refusals without waiting for poll timeout", async () => {
    let fetchCalls = 0;
    const session = {
      async fetch() {
        fetchCalls += 1;
        throw new Error("poll should not be called for policy refusal");
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-refusal","message":{"content":{"content_type":"text","parts":["抱歉，我无法生成涉及性内容或色情暗示的图像。"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.kind, "input_blocked");
        assert.equal(error.retryAction, "revise_input");
        assert.equal(error.retryable, false);
        assert.equal(error.stage, "submit");
        assert.equal(error.upstreamConversationId, "conv-refusal");
        assert.equal(fetchCalls, 0);
        return true;
      },
    );
  });

  it("preserves the first concrete download failure in the aggregate error", async () => {
    let attempts = 0;
    const session = {
      async fetch() {
        attempts += 1;
        throw new Error("socket hang up");
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-1","message":{"content":{"content_type":"text","parts":["sediment://file_1"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.message, "failed to download any images: socket hang up");
        assert.equal(error.kind, "result_fetch_failed");
        assert.equal(error.retryAction, "retry_download");
        assert.equal(error.stage, "download");
        assert.equal(error.upstreamConversationId, "conv-1");
        assert.deepEqual(error.fileIds, ["sed:file_1"]);
        assert.equal(attempts, 4);
        return true;
      },
    );
  });
});
