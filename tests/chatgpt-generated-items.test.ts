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

  it("does not treat user-uploaded reference attachments as generated output when upstream refuses", async () => {
    const refusalText = "非常抱歉，生成的图片可能违反了关于潜在欺诈或诈骗活动的防护限制。如果你认为此判断有误，请重试或修改提示语。";
    const fetchedUrls: string[] = [];
    const session = {
      async fetch(url: string) {
        fetchedUrls.push(url);
        if (url.endsWith("/backend-api/conversation/conv-edit-refusal")) {
          return new Response(JSON.stringify({
            mapping: {
              node_user: {
                message: {
                  id: "msg-user",
                  author: { role: "user" },
                  create_time: 1,
                  content: {
                    content_type: "multimodal_text",
                    parts: [
                      { asset_pointer: "sediment://file_upload_a" },
                      { asset_pointer: "sediment://file_upload_b" },
                    ],
                  },
                },
              },
              node_assistant: {
                message: {
                  id: "msg-assistant",
                  author: { role: "assistant" },
                  create_time: 2,
                  content: {
                    content_type: "text",
                    parts: [refusalText],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-edit-refusal","message":{"id":"msg-pending","content":{"content_type":"text","parts":["正在处理图片"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.kind, "input_blocked");
        assert.equal(error.retryAction, "revise_input");
        assert.equal(error.retryable, false);
        assert.equal(error.upstreamConversationId, "conv-edit-refusal");
        assert.ok(!fetchedUrls.some((url) => url.includes("/attachment/file_upload_a")));
        assert.ok(!fetchedUrls.some((url) => url.includes("/attachment/file_upload_b")));
        return true;
      },
    );
  });

  it("does not extract image ids from unknown author roles even when sediment pointers are present", async () => {
    const session = {
      async fetch(url: string) {
        if (url.endsWith("/backend-api/conversation/conv-unknown-role")) {
          return new Response(JSON.stringify({
            mapping: {
              node_system: {
                message: {
                  id: "msg-system",
                  author: { role: "system" },
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_system_leak" }],
                  },
                },
              },
              node_unknown: {
                message: {
                  id: "msg-unknown",
                  author: { role: "developer" },
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_unknown_leak" }],
                  },
                },
              },
              node_assistant_refusal: {
                message: {
                  id: "msg-refusal",
                  author: { role: "assistant" },
                  create_time: 99,
                  content: {
                    content_type: "text",
                    parts: ["抱歉，我无法生成涉及性内容或色情暗示的图像。"],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-unknown-role","message":{"id":"msg-pending","content":{"content_type":"text","parts":["正在处理图片"]}}}',
      "data: [DONE]",
    ].join("\n");

    await assert.rejects(
      () => collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a"),
      (error) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.kind, "input_blocked");
        return true;
      },
    );
  });

  it("returns only the latest turn's generated file ids when the conversation history has earlier turns", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const session = {
      async fetch(url: string) {
        if (url.endsWith("/backend-api/conversation/conv-multi-turn")) {
          return new Response(JSON.stringify({
            mapping: {
              old_tool: {
                message: {
                  id: "msg-old",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  // Five minutes ago — clearly a previous turn.
                  create_time: nowSec - 300,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_previous_turn" }],
                  },
                },
              },
              new_tool: {
                message: {
                  id: "msg-new",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  create_time: nowSec,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_current_turn" }],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/attachment/file_current_turn/download")) {
          return new Response(JSON.stringify({ download_url: "https://download.local/current.png" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://download.local/current.png") {
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-multi-turn","message":{"id":"msg-progress","content":{"content_type":"text","parts":["正在处理图片"]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_current_turn");
    assert.equal(result.data[0]?.parent_message_id, "msg-new");
  });

  it("does not return a previous turn's tool message when the new image has not been generated yet", async () => {
    // The toughest variant of the multi-turn pollution bug: the new image is still in flight,
    // so the polled mapping only contains the *previous* turn's tool message. Without a submit-
    // time baseline the runner would happily treat that stale image as today's result. The
    // submit-time baseline forces it to keep polling instead.
    const nowSec = Math.floor(Date.now() / 1000);
    let pollCount = 0;
    const downloadedIds: string[] = [];
    const session = {
      async fetch(url: string) {
        if (url.endsWith("/backend-api/conversation/conv-stale-only")) {
          pollCount += 1;
          // First two polls only show the previous turn; the third poll surfaces the new
          // tool message (as it would once the upstream actually finishes generating).
          if (pollCount >= 3) {
            return new Response(JSON.stringify({
              mapping: {
                stale_tool: {
                  message: {
                    id: "msg-stale",
                    author: { role: "tool" },
                    metadata: { async_task_type: "image_gen" },
                    // 30 minutes earlier — must be ignored.
                    create_time: nowSec - 1800,
                    content: {
                      content_type: "multimodal_text",
                      parts: [{ asset_pointer: "sediment://file_stale" }],
                    },
                  },
                },
                fresh_tool: {
                  message: {
                    id: "msg-fresh",
                    author: { role: "tool" },
                    metadata: { async_task_type: "image_gen" },
                    create_time: nowSec,
                    content: {
                      content_type: "multimodal_text",
                      parts: [{ asset_pointer: "sediment://file_fresh" }],
                    },
                  },
                },
              },
            }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            mapping: {
              stale_tool: {
                message: {
                  id: "msg-stale",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  create_time: nowSec - 1800,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_stale" }],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const matchAttachment = /\/attachment\/([^/]+)\/download/.exec(url);
        if (matchAttachment) {
          return new Response(JSON.stringify({ download_url: `https://download.local/${matchAttachment[1]}.png` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith("https://download.local/")) {
          const file = url.slice("https://download.local/".length).replace(/\.png$/, "");
          downloadedIds.push(file);
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-stale-only","message":{"id":"msg-progress","content":{"content_type":"text","parts":["正在处理图片"]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.file_id, "sed:file_fresh");
    assert.deepEqual(downloadedIds, ["file_fresh"], "stale tool message must never be downloaded");
    assert.ok(pollCount >= 3, "polling must keep going until the fresh tool message appears");
  });

  it("keeps every image of a multi-image turn even when their tool messages stream tens of seconds apart", async () => {
    // Reproduces the "slow follow-up image" case within the submit-time baseline window: a
    // multi-image turn whose extra slots finish a few dozen seconds after the first one. The
    // gap-based clustering keeps them together as one current turn while an older message from
    // a previous turn is discarded.
    const nowSec = Math.floor(Date.now() / 1000);
    const downloadedIds: string[] = [];
    const session = {
      async fetch(url: string) {
        if (url.endsWith("/backend-api/conversation/conv-slow-batch")) {
          return new Response(JSON.stringify({
            mapping: {
              fast_image: {
                message: {
                  id: "msg-fast",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  // 20 seconds before the slow one — still within the current turn baseline.
                  create_time: nowSec - 20,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_fast" }],
                  },
                },
              },
              slow_image: {
                message: {
                  id: "msg-slow",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  create_time: nowSec,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_slow" }],
                  },
                },
              },
              long_idle_then_new_turn: {
                message: {
                  id: "msg-prev",
                  author: { role: "tool" },
                  metadata: { async_task_type: "image_gen" },
                  // 10 minutes earlier — must be discarded as a previous turn.
                  create_time: nowSec - 600,
                  content: {
                    content_type: "multimodal_text",
                    parts: [{ asset_pointer: "sediment://file_prev_turn" }],
                  },
                },
              },
            },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const matchAttachment = /\/attachment\/([^/]+)\/download/.exec(url);
        if (matchAttachment) {
          return new Response(JSON.stringify({ download_url: `https://download.local/${matchAttachment[1]}.png` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.startsWith("https://download.local/")) {
          const file = url.slice("https://download.local/".length).replace(/\.png$/, "");
          downloadedIds.push(file);
          return new Response(Buffer.from("png-binary"), { status: 200 });
        }
        throw new Error(`unexpected url: ${url}`);
      },
    };
    const raw = [
      'data: {"conversation_id":"conv-slow-batch","message":{"id":"msg-progress","content":{"content_type":"text","parts":["正在处理图片"]}}}',
      "data: [DONE]",
    ].join("\n");

    const result = await collectGeneratedItems(session, "token-a", "device-a", raw, "prompt-a");

    const fileIds = result.data.map((item) => item.file_id).sort();
    assert.deepEqual(fileIds, ["sed:file_fast", "sed:file_slow"]);
    assert.ok(!downloadedIds.includes("file_prev_turn"), "previous turn file must not be downloaded");
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
