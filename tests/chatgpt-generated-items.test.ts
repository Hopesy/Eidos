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
      'data: {"conversation_id":"conv-retry","message":{"author":{"role":"tool"},"metadata":{"async_task_type":"image_gen"},"content":{"content_type":"multimodal_text","parts":[{"asset_pointer":"sediment://file_1"}]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(downloadUrlCalls, 3);
    assert.equal(imageDownloadCalls, 3);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_1");
  });

  it("ignores source attachment pointers in streamed text and polls for generated output", async () => {
    const fetchedUrls: string[] = [];
    const session = {
      async fetch(url: string) {
        fetchedUrls.push(url);
        if (url.endsWith("/backend-api/conversation/conv-source")) {
          return new Response(JSON.stringify({
            mapping: {
              node_1: {
                message: {
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_result" }],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/attachment/file_result/download")) {
          return new Response(JSON.stringify({ download_url: "https://download.local/result.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/result.png") {
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-source","message":{"content":{"content_type":"text","parts":["{\\"source\\":\\"sediment://file_source\\",\\"prompt\\":\\"make image\\"}"]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_result");
    assert.ok(fetchedUrls.some((url) => url.includes("/backend-api/conversation/conv-source")));
    assert.ok(!fetchedUrls.some((url) => url.includes("/attachment/file_source/download")));
  });

  it("falls back to conversation mapping when streamed file ids are stale", async () => {
    let staleDownloadCalls = 0;
    const session = {
      async fetch(url: string) {
        if (url.endsWith("/attachment/file_stale/download")) {
          return new Response(JSON.stringify({ download_url: "https://download.local/stale.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/stale.png") {
          staleDownloadCalls += 1;
          return new Response("not found", { status: 404 });
        }
        if (url.endsWith("/backend-api/conversation/conv-fallback")) {
          return new Response(JSON.stringify({
            mapping: {
              node_1: {
                message: {
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_result" }],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/attachment/file_result/download")) {
          return new Response(JSON.stringify({ download_url: "https://download.local/result.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/result.png") {
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-fallback","message":{"author":{"role":"tool"},"metadata":{"async_task_type":"image_gen"},"content":{"content_type":"multimodal_text","parts":[{"asset_pointer":"sediment://file_stale"}]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(staleDownloadCalls, 4);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_result");
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

  it("does not fall back to polling for non-recoverable download failures", async () => {
    let pollCalled = false;
    const session = {
      async fetch(url: string) {
        if (url.includes("/attachment/file_error/download")) {
          return new Response(JSON.stringify({ download_url: "https://download.local/error.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/error.png") {
          return new Response("server error", { status: 500 });
        }
        if (url.endsWith("/backend-api/conversation/conv-error")) {
          pollCalled = true;
          return new Response(JSON.stringify({ mapping: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-error","message":{"author":{"role":"tool"},"metadata":{"async_task_type":"image_gen"},"content":{"content_type":"multimodal_text","parts":[{"asset_pointer":"sediment://file_error"}]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.kind, "result_fetch_failed");
        assert.equal(error.retryAction, "retry_download");
        return true;
      },
    );

    assert.equal(pollCalled, false, "poll should not be called for 500 errors");
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
      'data: {"conversation_id":"conv-1","message":{"author":{"role":"tool"},"metadata":{"async_task_type":"image_gen"},"content":{"content_type":"multimodal_text","parts":[{"asset_pointer":"sediment://file_1"}]}}}',
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
