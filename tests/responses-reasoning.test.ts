import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  editImageResultWithResponsesApiService,
  generateImageResultWithResponsesApiService,
} from "../src/server/providers/openai/responses-image-adapter.ts";
import { extractResponsesReasoningEffortFromBody } from "../src/server/providers/openai/responses-reasoning.ts";
import { sanitizeConfigPayload } from "../src/shared/app-config.ts";

function createResponsesFetchRecorder() {
  const calls: Array<Record<string, unknown>> = [];
  const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({
      id: "resp_test",
      output: [
        {
          id: "ig_test",
          type: "image_generation_call",
          result: "aW1hZ2U=",
          revised_prompt: "revised prompt",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchMock };
}

describe("responses reasoning effort", () => {
  it("keeps config defaults behavior-preserving", () => {
    const defaults = sanitizeConfigPayload({});
    assert.equal(defaults.chatgpt?.responsesReasoningEffort, "default");

    const high = sanitizeConfigPayload({
      chatgpt: {
        responsesReasoningEffort: "high",
      },
    });
    assert.equal(high.chatgpt?.responsesReasoningEffort, "high");

    const invalid = sanitizeConfigPayload({
      chatgpt: {
        responsesReasoningEffort: "unsupported",
      },
    });
    assert.equal(invalid.chatgpt?.responsesReasoningEffort, "default");
  });

  it("sends reasoning.effort to upstream Responses requests when configured", async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchMock } = createResponsesFetchRecorder();
    globalThis.fetch = fetchMock;
    try {
      await generateImageResultWithResponsesApiService(
        {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
          apiStyle: "responses",
          responsesModel: "gpt-5.5",
          responsesReasoningEffort: "high",
        },
        "draw a glass city",
        "gpt-image-1",
        1,
        { format: "png" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].reasoning, { effort: "high" });
  });

  it("omits reasoning from upstream Responses requests when left at default", async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchMock } = createResponsesFetchRecorder();
    globalThis.fetch = fetchMock;
    try {
      await generateImageResultWithResponsesApiService(
        {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
          apiStyle: "responses",
          responsesModel: "gpt-5.5",
          responsesReasoningEffort: "default",
        },
        "draw a glass city",
        "gpt-image-1",
        1,
        { format: "png" },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0], "reasoning"), false);
  });

  it("allows a request-level reasoning effort to override the saved setting", async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchMock } = createResponsesFetchRecorder();
    globalThis.fetch = fetchMock;
    try {
      await generateImageResultWithResponsesApiService(
        {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
          apiStyle: "responses",
          responsesModel: "gpt-5.5",
          responsesReasoningEffort: "high",
        },
        "draw a glass city",
        "gpt-image-1",
        1,
        {
          format: "png",
          responsesReasoningEffort: "low",
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].reasoning, { effort: "low" });
  });

  it("sends reasoning.effort to upstream Responses edit requests", async () => {
    const originalFetch = globalThis.fetch;
    const { calls, fetchMock } = createResponsesFetchRecorder();
    globalThis.fetch = fetchMock;
    try {
      await editImageResultWithResponsesApiService(
        {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
          apiStyle: "responses",
          responsesModel: "gpt-5.5",
          responsesReasoningEffort: "minimal",
        },
        {
          prompt: "make it watercolor",
          images: [new File([new Uint8Array([1, 2, 3])], "input.png", { type: "image/png" })],
          format: "webp",
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].reasoning, { effort: "minimal" });
  });

  it("parses local /v1/responses reasoning.effort and rejects unsupported values", () => {
    assert.deepEqual(extractResponsesReasoningEffortFromBody({}), { ok: true });
    assert.deepEqual(extractResponsesReasoningEffortFromBody({ reasoning: { effort: "high" } }), {
      ok: true,
      effort: "high",
    });
    assert.deepEqual(extractResponsesReasoningEffortFromBody({ reasoning: { effort: "unsupported" } }), { ok: false });
  });
});
