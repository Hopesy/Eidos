import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { beginRequest, finishRequest } from "../src/features/image-workbench/request-lifecycle.ts";
import type { ActiveRequestState } from "../src/features/image-workbench/utils.ts";
import type { ActiveRequestMeta, PendingAbortAction, SubmissionContext } from "../src/features/image-workbench/submission-types.ts";

function createContext(): SubmissionContext & {
  isSubmitting: boolean;
  activeRequest: ActiveRequestState | null;
  submitStartedAt: number | null;
} {
  const ctx = {
    mountedRef: { current: true },
    requestAbortControllerRef: { current: null as AbortController | null },
    pendingAbortActionRef: { current: null as PendingAbortAction | null },
    activeRequestMetaRef: { current: null as ActiveRequestMeta | null },
    isSubmitting: false,
    activeRequest: null as ActiveRequestState | null,
    submitStartedAt: null as number | null,
    setIsSubmitting(value: boolean | ((current: boolean) => boolean)) {
      ctx.isSubmitting = typeof value === "function" ? value(ctx.isSubmitting) : value;
    },
    setActiveRequest(value: ActiveRequestState | null | ((current: ActiveRequestState | null) => ActiveRequestState | null)) {
      ctx.activeRequest = typeof value === "function" ? value(ctx.activeRequest) : value;
    },
    setSubmitElapsedSeconds() {
      return undefined;
    },
    setSubmitStartedAt(value: number | null | ((current: number | null) => number | null)) {
      ctx.submitStartedAt = typeof value === "function" ? value(ctx.submitStartedAt) : value;
    },
    setConversations() {
      return undefined;
    },
    setImagePrompt() {
      return undefined;
    },
    setSourceImages() {
      return undefined;
    },
    setEditorTarget() {
      return undefined;
    },
    focusConversation() {
      return undefined;
    },
    updateConversation: async () => undefined,
    persistConversation: async () => undefined,
    resetComposer() {
      return undefined;
    },
    retractTurnAfterAbort: async () => true,
    restoreComposerFromTurn() {
      return undefined;
    },
  };
  return ctx as unknown as SubmissionContext & {
    isSubmitting: boolean;
    activeRequest: ActiveRequestState | null;
    submitStartedAt: number | null;
  };
}

describe("image request lifecycle", () => {
  it("does not clear a newer active request when an older canceled request finishes", () => {
    const ctx = createContext();
    const firstRequest: ActiveRequestState = {
      conversationId: "conversation-1",
      turnId: "turn-1",
      mode: "generate",
      count: 1,
      variant: "standard",
    };
    const secondRequest: ActiveRequestState = {
      conversationId: "conversation-1",
      turnId: "turn-2",
      mode: "generate",
      count: 1,
      variant: "standard",
    };

    beginRequest(ctx, firstRequest, 100, true);
    beginRequest(ctx, secondRequest, 200, true);
    const secondController = ctx.requestAbortControllerRef.current;

    finishRequest(ctx, firstRequest.conversationId, firstRequest.turnId);

    assert.equal(ctx.requestAbortControllerRef.current, secondController);
    assert.deepEqual(ctx.activeRequestMetaRef.current, {
      conversationId: secondRequest.conversationId,
      turnId: secondRequest.turnId,
      retractOnEdit: true,
    });
    assert.equal(ctx.isSubmitting, true);
    assert.equal(ctx.activeRequest?.turnId, secondRequest.turnId);
    assert.equal(ctx.submitStartedAt, 200);

    finishRequest(ctx, secondRequest.conversationId, secondRequest.turnId);
  });

  it("clears only the matching pending abort action", () => {
    const ctx = createContext();
    const request: ActiveRequestState = {
      conversationId: "conversation-1",
      turnId: "turn-1",
      mode: "generate",
      count: 1,
      variant: "standard",
    };
    beginRequest(ctx, request, 100, true);
    ctx.pendingAbortActionRef.current = {
      conversationId: "conversation-1",
      turnId: "turn-2",
      retractTurn: true,
    };

    finishRequest(ctx, request.conversationId, request.turnId);

    assert.deepEqual(ctx.pendingAbortActionRef.current, {
      conversationId: "conversation-1",
      turnId: "turn-2",
      retractTurn: true,
    });
  });
});
