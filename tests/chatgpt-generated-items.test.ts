import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePollWaitMs,
  POLL_MAX_WAIT_MS,
  POLL_MIN_WAIT_MS,
  pollImageIds,
} from "../src/server/providers/chatgpt/result-download-adapter.ts";
import { collectGeneratedItems, recoverGeneratedItems } from "../src/server/providers/chatgpt/generated-items.ts";
import { ImageGenerationError } from "../src/server/providers/openai/image-errors.ts";

describe("chatgpt generated item collection", () => {
  it("caps polling windows to three minutes", () => {
    assert.equal(normalizePollWaitMs(1), POLL_MIN_WAIT_MS);
    assert.equal(normalizePollWaitMs(60_000), 60_000);
    assert.equal(normalizePollWaitMs(999_999), POLL_MAX_WAIT_MS);
    assert.equal(POLL_MAX_WAIT_MS, 180_000);
  });

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

  it("passes account auth headers when downloading ChatGPT estuary content", async () => {
    let downloadHeaders: Headers | null = null;
    const session = {
      async fetch(url: string, options?: RequestInit) {
        if (url.includes("/attachment/")) {
          return new Response(JSON.stringify({
            download_url: "https://chatgpt.com/backend-api/estuary/content?id=file_1&sig=abc",
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith("https://chatgpt.com/backend-api/estuary/content")) {
          downloadHeaders = new Headers(options?.headers);
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-auth","message":{"author":{"role":"tool"},"metadata":{"async_task_type":"image_gen"},"content":{"content_type":"multimodal_text","parts":[{"asset_pointer":"sediment://file_1"}]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(result.data.length, 1);
    assert.equal(downloadHeaders?.get("authorization"), "Bearer token-a");
    assert.equal(downloadHeaders?.get("oai-device-id"), "device-a");
  });

  it("extracts generated image parts when the upstream message also includes follow-up text", async () => {
    let downloadUrlCalls = 0;
    let pollCalls = 0;
    const session = {
      async fetch(url: string) {
        if (url.includes("/attachment/file_mixed/download")) {
          downloadUrlCalls += 1;
          return new Response(JSON.stringify({ download_url: "https://download.local/mixed.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/mixed.png") {
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        if (url.includes("/backend-api/conversation/conv-mixed")) {
          pollCalls += 1;
          throw new Error("poll should not be called when streamed image part is present");
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      `data: ${JSON.stringify({
        conversation_id: "conv-mixed",
        message: {
          author: { role: "assistant" },
          content: {
            content_type: "multimodal_text",
            parts: [
              { content_type: "image_asset_pointer", asset_pointer: "sediment://file_mixed" },
              {
                content_type: "text",
                text: "You are responding immediately after an image generation result. ALWAYS start with one short sentence describing the image.",
              },
            ],
          },
        },
      })}`,
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_mixed");
    assert.equal(downloadUrlCalls, 1);
    assert.equal(pollCalls, 0);
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
                  id: "msg-result",
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
    assert.equal(result.data[0]?.parent_message_id, "msg-result");
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
                  id: "msg-result",
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
    assert.equal(result.data[0]?.parent_message_id, "msg-result");
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

  it("uses the web conversation title to short-circuit image generation refusals", async () => {
    let fetchCalls = 0;
    const session = {
      async fetch() {
        fetchCalls += 1;
        return new Response(JSON.stringify({
          title: "图像生成请求拒绝",
          mapping: {},
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };

    await assert.rejects(
      () => pollImageIds(session, "token-a", "device-a", "conv-title-refusal", { maxWaitMs: 3000 }),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.message, "图像生成请求被上游拒绝，请修改提示词后重试");
        assert.equal(error.kind, "input_blocked");
        assert.equal(error.retryAction, "revise_input");
        assert.equal(error.retryable, false);
        assert.equal(error.stage, "submit");
        assert.equal(error.upstreamConversationId, "conv-title-refusal");
        assert.equal(error.upstreamBodyPreview, "图像生成请求拒绝");
        return true;
      },
    );
    assert.equal(fetchCalls, 1);
  });

  it("classifies repeated poll 429 responses as upstream rate limits", async () => {
    let fetchCalls = 0;
    const session = {
      async fetch() {
        fetchCalls += 1;
        return new Response(JSON.stringify({ error: "too many polling requests" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
          },
        });
      },
    };

    await assert.rejects(
      () => pollImageIds(session, "token-a", "device-a", "conv-rate", { maxWaitMs: 3200 }),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.message, "轮询图片结果被上游限流，请稍后再试");
        assert.equal(error.kind, "poll_rate_limited");
        assert.equal(error.retryAction, "resume_polling");
        assert.equal(error.stage, "poll");
        assert.equal(error.statusCode, 429);
        assert.equal(error.lastPollStatus, 429);
        assert.deepEqual(error.pollStatusCounts, { "429": 1 });
        assert.equal(error.pollAttempts, 1);
        assert.equal(error.retryAfterMs, 0);
        assert.match(error.upstreamBodyPreview ?? "", /too many polling requests/);
        assert.equal(error.upstreamConversationId, "conv-rate");
        return true;
      },
    );
    assert.equal(fetchCalls, 1);
  });

  it("stops polling when the caller aborts the image request", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    const session = {
      async fetch() {
        fetchCalls += 1;
        controller.abort();
        return new Response(JSON.stringify({ mapping: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-abort","message":{"content":{"content_type":"text","parts":["still rendering"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a", { signal: controller.signal }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "AbortError");
        assert.equal(error.message, "request canceled");
        return true;
      },
    );
    assert.equal(fetchCalls, 1);
  });

  it("keeps the source account id on recoverable recovery download failures", async () => {
    const session = {
      async fetch() {
        throw new Error("socket hang up");
      },
    };

    await assert.rejects(
      () => recoverGeneratedItems(session, "token-a", "device-a", {
        conversationId: "conv-recover",
        parentMessageId: "msg-recover",
        fileIds: ["sed:file_1"],
        sourceAccountId: "account-1",
      }),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.kind, "result_fetch_failed");
        assert.equal(error.retryAction, "retry_download");
        assert.equal(error.stage, "download");
        assert.equal(error.upstreamConversationId, "conv-recover");
        assert.equal(error.upstreamParentMessageId, "msg-recover");
        assert.equal(error.sourceAccountId, "account-1");
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

  it("short-circuits fraud protection refusals without polling", async () => {
    let fetchCalls = 0;
    const session = {
      async fetch() {
        fetchCalls += 1;
        throw new Error("poll should not be called for fraud protection refusal");
      },
    };
    const text = "非常抱歉，生成的图片可能违反了关于潜在欺诈或诈骗活动的防护限制。如果你认为此判断有误，请重试或修改提示语。";
    const raw = [
      `data: ${JSON.stringify({ conversation_id: "conv-fraud-refusal", message: { content: { content_type: "text", parts: [text] } } })}`,
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
        assert.equal(error.upstreamConversationId, "conv-fraud-refusal");
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
