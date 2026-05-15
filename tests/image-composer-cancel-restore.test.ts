import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { restoreComposerFromTurn } from "../src/features/image-workbench/conversation-editing.ts";
import type { ImageConversationTurn, StoredSourceImage } from "../src/store/image-conversations.ts";

function createTurn(sourceImages: StoredSourceImage[] = []): ImageConversationTurn {
  return {
    id: "turn-1",
    title: "生成",
    mode: "generate",
    prompt: "调整成亮色",
    model: "gpt-image-2",
    imageSize: "auto",
    imageQuality: "medium",
    imageFormat: "png",
    count: 1,
    sourceImages,
    images: [{ id: "turn-1-0", status: "loading" }],
    createdAt: "2026-05-14T12:57:01.000Z",
    status: "generating",
  };
}

function createSourceImage(overrides: Partial<StoredSourceImage> = {}): StoredSourceImage {
  return {
    id: "source-1",
    role: "image",
    name: "reference.png",
    dataUrl: "data:image/png;base64,cmVmZXJlbmNl",
    ...overrides,
  };
}

function withAnimationFrame(callback: () => void) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    requestAnimationFrame: (frame: FrameRequestCallback) => {
      frame(0);
      return 1;
    },
  };
  try {
    callback();
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
}

describe("image composer cancel restore", () => {
  it("keeps latest-result reference enabled after canceling a generated reference edit", () => {
    const source = createSourceImage({ hiddenInConversation: true });
    let reuseLatestResultForGenerate: boolean | null = null;
    let restoredSources: StoredSourceImage[] = [];
    let restoredPrompt = "";
    let focusedConversationId = "";

    withAnimationFrame(() => {
      restoreComposerFromTurn({
        isSubmitting: true,
        activeRequest: { conversationId: "conversation-1", turnId: "turn-1", mode: "generate", count: 1, variant: "standard" },
        focusConversation: (id) => {
          focusedConversationId = id;
        },
        openDraftConversation: () => undefined,
        setMode: () => undefined,
        setImageModel: () => undefined,
        setImageCount: () => undefined,
        setImageSize: () => undefined,
        setImageQuality: () => undefined,
        setImageFormat: () => undefined,
        setUpscaleQuality: () => undefined,
        setReuseLatestResultForGenerate: (value) => {
          reuseLatestResultForGenerate = value as boolean;
        },
        setSourceImages: (value) => {
          restoredSources = value as StoredSourceImage[];
        },
        setImagePrompt: (value) => {
          restoredPrompt = value as string;
        },
        setEditorTarget: () => undefined,
        textareaRef: { current: { focus: () => undefined, selectionStart: 0, selectionEnd: 0 } as HTMLTextAreaElement },
      }, "conversation-1", createTurn([source]));
    });

    assert.equal(focusedConversationId, "conversation-1");
    assert.equal(reuseLatestResultForGenerate, true);
    assert.equal(restoredPrompt, "调整成亮色");
    assert.equal(restoredSources.length, 1);
    assert.equal(restoredSources[0]?.hiddenInConversation, true);
    assert.notEqual(restoredSources[0]?.id, source.id);
  });

  it("does not enable latest-result reference for visible uploaded source images", () => {
    const source = createSourceImage({ hiddenInConversation: false });
    let reuseLatestResultForGenerate: boolean | null = null;

    withAnimationFrame(() => {
      restoreComposerFromTurn({
        isSubmitting: false,
        activeRequest: null,
        focusConversation: () => undefined,
        openDraftConversation: () => undefined,
        setMode: () => undefined,
        setImageModel: () => undefined,
        setImageCount: () => undefined,
        setImageSize: () => undefined,
        setImageQuality: () => undefined,
        setImageFormat: () => undefined,
        setUpscaleQuality: () => undefined,
        setReuseLatestResultForGenerate: (value) => {
          reuseLatestResultForGenerate = value as boolean;
        },
        setSourceImages: () => undefined,
        setImagePrompt: () => undefined,
        setEditorTarget: () => undefined,
        textareaRef: { current: null },
      }, "conversation-1", createTurn([source]));
    });

    assert.equal(reuseLatestResultForGenerate, false);
  });
});
