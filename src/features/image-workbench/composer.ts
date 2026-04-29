import type { ClipboardEvent as ReactClipboardEvent, Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ImageGenerationQuality, ImageModel } from "@/lib/api";
import type { ImageMode, StoredImage, StoredSourceImage } from "@/store/image-conversations";
import type { ImageRatioOption } from "@/shared/image-generation";
import type { EditorTarget } from "./submission";
import { buildImageDataUrl, createSourceImageFromResult, fileToDataUrl, makeId } from "./utils";

export type PromptExample = {
  model: ImageModel;
  count: number;
  prompt: string;
};

type ComposerContext = {
  mode: ImageMode;
  isSubmitting: boolean;
  latestReusableSourceImage: StoredSourceImage | null;
  latestReusableImageDataUrl: string;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  setPendingPickerMode: Dispatch<SetStateAction<ImageMode | null>>;
  setMode: Dispatch<SetStateAction<ImageMode>>;
  setImagePrompt: Dispatch<SetStateAction<string>>;
  setImageCount: Dispatch<SetStateAction<string>>;
  setImageModel: Dispatch<SetStateAction<ImageModel>>;
  setImageSize: Dispatch<SetStateAction<ImageRatioOption>>;
  setImageQuality: Dispatch<SetStateAction<ImageGenerationQuality>>;
  setUpscaleQuality: Dispatch<SetStateAction<ImageGenerationQuality>>;
  setReuseLatestResultForGenerate: Dispatch<SetStateAction<boolean>>;
  setSourceImages: Dispatch<SetStateAction<StoredSourceImage[]>>;
  setEditorTarget: Dispatch<SetStateAction<EditorTarget | null>>;
  focusConversation: (conversationId: string) => void;
  openDraftConversation: () => void;
};

export function resetComposer(ctx: ComposerContext, nextMode: ImageMode = ctx.mode) {
  ctx.setMode(nextMode);
  ctx.setImagePrompt("");
  ctx.setImageCount("1");
  ctx.setImageSize("auto");
  ctx.setImageQuality("medium");
  ctx.setUpscaleQuality("medium");
  ctx.setReuseLatestResultForGenerate(true);
  ctx.setSourceImages([]);
}

export function handleModeChange(ctx: ComposerContext, nextMode: ImageMode) {
  ctx.setMode(nextMode);
  ctx.setSourceImages((prev) => {
    const hiddenItems = prev.filter((item) => item.hiddenInConversation);
    const visibleItems = prev.filter((item) => !item.hiddenInConversation);
    const explicitImageItems = visibleItems.filter((item) => item.role === "image");
    const maskItems = visibleItems.filter((item) => item.role === "mask");

    if (nextMode === "generate") {
      return hiddenItems.filter((item) => item.role === "image");
    }

    if (nextMode !== "edit") {
      if (nextMode === "upscale") {
        if (explicitImageItems.length > 0) {
          return [explicitImageItems[0]];
        }
        if (!ctx.latestReusableSourceImage) {
          return [];
        }
        return [
          {
            ...ctx.latestReusableSourceImage,
            id: makeId(),
            name: "upscale-source.png",
            hiddenInConversation: false,
          },
        ];
      }

      return visibleItems.filter((item) => item.role !== "mask");
    }

    if (explicitImageItems.length > 0) {
      return [...explicitImageItems, ...maskItems];
    }
    if (!ctx.latestReusableSourceImage) {
      return visibleItems;
    }

    return [
      {
        ...ctx.latestReusableSourceImage,
        id: makeId(),
        name: "inherited-source.png",
        hiddenInConversation: false,
      },
    ];
  });
}

export function openImagePickerForMode(ctx: ComposerContext, nextMode: ImageMode) {
  if (ctx.isSubmitting) {
    return;
  }
  ctx.setPendingPickerMode(nextMode);
  handleModeChange(ctx, nextMode);
}

export function applyPromptExample(ctx: ComposerContext, example: PromptExample) {
  handleModeChange(ctx, "generate");
  ctx.setImageModel(example.model);
  ctx.setImageCount(String(example.count));
  ctx.setImageSize("auto");
  ctx.setImageQuality("high");
  ctx.setImagePrompt(example.prompt);
  ctx.openDraftConversation();
  ctx.setSourceImages([]);
  ctx.textareaRef.current?.focus();
}

export function handleCreateDraft(ctx: ComposerContext) {
  ctx.openDraftConversation();
  resetComposer(ctx, "generate");
  ctx.textareaRef.current?.focus();
}

export async function appendFiles(
  ctx: Pick<ComposerContext, "mode" | "setSourceImages">,
  files: File[] | FileList | null,
  role: "image" | "mask",
) {
  const normalizedFiles = files ? Array.from(files) : [];
  if (normalizedFiles.length === 0) {
    return;
  }

  const nextItems = await Promise.all(
    normalizedFiles.map(async (file) => ({
      id: makeId(),
      role,
      name: file.name,
      dataUrl: await fileToDataUrl(file),
    })),
  );

  ctx.setSourceImages((prev) => {
    if (role === "mask") {
      return [...prev.filter((item) => item.role !== "mask"), nextItems[0]];
    }
    if (ctx.mode === "upscale") {
      return [
        ...prev.filter((item) => item.role === "mask"),
        {
          ...nextItems[0],
          name: nextItems[0]?.name || "upscale.png",
        },
      ];
    }
    return [
      ...prev.filter((item) => item.role !== "mask"),
      ...prev.filter((item) => item.role === "mask"),
      ...nextItems,
    ];
  });
}

export function handlePromptPaste(
  ctx: Pick<ComposerContext, "isSubmitting" | "mode"> & Pick<ComposerContext, "setSourceImages">,
  event: ReactClipboardEvent<HTMLTextAreaElement>,
) {
  if (ctx.isSubmitting) {
    return;
  }

  const clipboardImages = Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (clipboardImages.length === 0) {
    return;
  }

  event.preventDefault();
  void appendFiles(ctx, clipboardImages, "image");
  toast.success(
    ctx.mode === "generate"
      ? "已从剪贴板添加参考图"
      : ctx.mode === "edit"
        ? "已从剪贴板添加源图"
        : "已从剪贴板添加增强源图",
  );
}

export function removeSourceImage(
  setSourceImages: Dispatch<SetStateAction<StoredSourceImage[]>>,
  id: string,
) {
  setSourceImages((prev) => prev.filter((item) => item.id !== id));
}

export function handleToggleLatestResultReference(
  ctx: Pick<ComposerContext, "latestReusableImageDataUrl" | "setReuseLatestResultForGenerate" | "textareaRef">,
) {
  if (!ctx.latestReusableImageDataUrl) {
    toast.error("当前会话还没有可沿用的生成结果");
    return;
  }
  ctx.setReuseLatestResultForGenerate((prev) => !prev);
  ctx.textareaRef.current?.focus();
}

export function seedFromResult(
  ctx: ComposerContext,
  conversationId: string,
  image: StoredImage,
  nextMode: ImageMode,
) {
  if (ctx.isSubmitting) {
    return;
  }

  const sourceImage = createSourceImageFromResult(image, "source.png");
  if (!sourceImage) {
    toast.error("当前图片没有可复用的数据");
    return;
  }

  ctx.focusConversation(conversationId);
  handleModeChange(ctx, nextMode);
  ctx.setSourceImages([sourceImage]);
  if (nextMode === "upscale") {
    ctx.setImagePrompt("");
  }
  ctx.textareaRef.current?.focus();
}

export function openSelectionEditor(
  ctx: Pick<ComposerContext, "isSubmitting" | "setEditorTarget">,
  conversationId: string,
  turnId: string,
  image: StoredImage,
  imageName: string,
) {
  if (ctx.isSubmitting) {
    return;
  }

  const dataUrl = buildImageDataUrl(image);
  if (!dataUrl) {
    toast.error("当前图片没有可复用的数据");
    return;
  }

  ctx.setEditorTarget({
    conversationId,
    turnId,
    image,
    imageName,
    sourceDataUrl: dataUrl,
  });
}
