import type { Account, ImageGenerationQuality, ImageGenerationSize, ImageModel } from "@/lib/api";
import { ApiRequestError } from "@/lib/request";
import { getUpscaleQualityLabel } from "@/shared/image-generation";
import { isImageTaskActive } from "@/store/image-active-tasks";
import { normalizeConversation, saveImageConversation, type ImageConversation, type ImageConversationTurn, type ImageMode, type StoredImage, type StoredSourceImage } from "@/store/image-conversations";

export type ActiveRequestState = {
  conversationId: string;
  turnId: string;
  mode: ImageMode;
  count: number;
  variant: "standard" | "selection-edit";
  imageId?: string;
};

type ResultItemPayload = {
  b64_json?: string;
  url?: string;
  image_id?: string;
  file_path?: string;
  revised_prompt?: string;
  text?: string;
  file_id?: string;
  gen_id?: string;
  response_id?: string;
  image_generation_call_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

export function cloneSourceImagesForComposer(sourceImages: StoredSourceImage[] = []) {
  return sourceImages.map((item) => ({
    ...item,
    id: makeId(),
  }));
}

export function buildConversationTitle(mode: ImageMode, prompt: string, upscaleQuality: ImageGenerationQuality = "auto") {
  const trimmed = prompt.trim();
  const prefix = mode === "generate"
    ? "生成"
    : mode === "edit"
      ? "编辑"
      : upscaleQuality === "auto"
        ? "增强"
        : `增强 ${getUpscaleQualityLabel(upscaleQuality)}`;
  if (!trimmed) {
    return prefix;
  }
  if (trimmed.length <= 8) {
    return `${prefix} · ${trimmed}`;
  }
  return `${prefix} · ${trimmed.slice(0, 8)}...`;
}

export function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status !== "禁用" && account.status !== "异常");
  return String(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

export async function normalizeConversationHistory(items: ImageConversation[]) {
  const normalized = items.map((item) => {
    let changed = false;
    const turns = (item.turns ?? []).map((turn) => {
      if (turn.status !== "generating" || isImageTaskActive(item.id, turn.id)) {
        return turn;
      }

      changed = true;
      const errorMessage = turn.images.some((image) => image.status === "success")
        ? turn.error || "任务已中断"
        : "页面已刷新，任务已中断";

      return {
        ...turn,
        status: "error" as const,
        error: errorMessage,
        images: turn.images.map((image) =>
          image.status === "loading"
            ? {
              ...image,
              status: "error" as const,
              error: "页面已刷新，任务已中断",
            }
            : image,
        ),
      };
    });

    const conversation = normalizeConversation(
      changed
        ? {
          ...item,
          turns,
        }
        : item,
    );

    return { conversation, changed };
  });

  await Promise.all(
    normalized
      .filter((item) => item.changed)
      .map((item) => saveImageConversation(item.conversation)),
  );

  return normalized.map((item) => item.conversation);
}

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildImageDataUrl(image: StoredImage) {
  if (image.url) {
    return image.url;
  }
  if (!image.b64_json) {
    return "";
  }
  return `data:image/png;base64,${image.b64_json}`;
}

export function getLatestSuccessfulImage(turns: ImageConversationTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const images = Array.isArray(turn.images) ? turn.images : [];
    for (let imageIndex = images.length - 1; imageIndex >= 0; imageIndex -= 1) {
      const image = images[imageIndex];
      if (image.status === "success" && (image.url || image.b64_json)) {
        return image;
      }
    }
  }
  return null;
}

export function createLoadingImages(count: number, conversationId: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${conversationId}-${index}`,
    status: "loading" as const,
  }));
}

export function createConversationTurn(payload: {
  turnId: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  imageSize?: ImageGenerationSize;
  imageQuality?: ImageGenerationQuality;
  count: number;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: "generating" | "success" | "error";
  error?: string;
}): ImageConversationTurn {
  return {
    id: payload.turnId,
    title: payload.title,
    mode: payload.mode,
    prompt: payload.prompt,
    model: payload.model,
    imageSize: payload.imageSize,
    imageQuality: payload.imageQuality,
    count: payload.count,
    scale: payload.scale,
    sourceImages: payload.sourceImages ?? [],
    images: payload.images,
    createdAt: payload.createdAt,
    status: payload.status,
    error: payload.error,
  };
}

export async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

export function createSourceImageFromResult(image: StoredImage, name: string, hiddenInConversation = false): StoredSourceImage | null {
  const dataUrl = buildImageDataUrl(image);
  if (!dataUrl) {
    return null;
  }
  return {
    id: makeId(),
    role: "image",
    name,
    dataUrl,
    hiddenInConversation,
    image_id: image.image_id,
    file_path: image.file_path,
    file_id: image.file_id,
    gen_id: image.gen_id,
    response_id: image.response_id,
    image_generation_call_id: image.image_generation_call_id,
    conversation_id: image.conversation_id,
    parent_message_id: image.parent_message_id,
    source_account_id: image.source_account_id,
  };
}

export function buildSourceReference(source: StoredSourceImage | null | undefined) {
  if (!source) {
    return null;
  }
  const originalFileId = String(source.file_id || "").trim();
  const originalGenId = String(source.gen_id || source.response_id || "").trim();
  const sourceAccountId = String(source.source_account_id || "").trim();
  if (!originalFileId || !sourceAccountId || !originalGenId) {
    return null;
  }
  return {
    original_file_id: originalFileId,
    original_gen_id: originalGenId,
    previous_response_id: String(source.response_id || "").trim() || undefined,
    image_generation_call_id: String(source.image_generation_call_id || "").trim() || undefined,
    conversation_id: String(source.conversation_id || "").trim() || undefined,
    parent_message_id: String(source.parent_message_id || "").trim() || undefined,
    source_account_id: sourceAccountId,
  };
}

export function createResultImage(id: string, item: ResultItemPayload | null | undefined): StoredImage {
  if (item?.url || item?.b64_json) {
    return {
      id,
      status: "success",
      ...(item.url ? { url: item.url } : { b64_json: item.b64_json }),
      image_id: item.image_id,
      file_path: item.file_path,
      revised_prompt: item.revised_prompt,
      file_id: item.file_id,
      gen_id: item.gen_id,
      response_id: item.response_id,
      image_generation_call_id: item.image_generation_call_id,
      conversation_id: item.conversation_id,
      parent_message_id: item.parent_message_id,
      source_account_id: item.source_account_id,
      failureKind: undefined,
      retryAction: undefined,
      retryable: undefined,
      stage: undefined,
      upstreamConversationId: undefined,
    };
  }

  if (item?.text) {
    return {
      id,
      status: "success",
      text: item.text,
    };
  }

  return {
    id,
    status: "error",
    error: "接口没有返回图片数据",
  };
}

export function mergeResultImages(conversationId: string, items: ResultItemPayload[], expected: number) {
  const results: StoredImage[] = items.map((item, index) => createResultImage(`${conversationId}-${index}`, item));

  if (expected > results.length) {
    for (let index = results.length; index < expected; index += 1) {
      results.push({
        id: `${conversationId}-${index}`,
        status: "error",
        error: "未返回足够数量的图片",
      });
    }
  }

  return results;
}

export function patchRetriedImages(existingImages: StoredImage[], retryIndexes: number[], items: ResultItemPayload[]) {
  const nextImages = existingImages.map((image) => ({ ...image }));
  retryIndexes.forEach((slotIndex, resultIndex) => {
    const current = nextImages[slotIndex];
    if (!current) {
      return;
    }
    nextImages[slotIndex] = createResultImage(current.id, items[resultIndex]);
  });

  if (items.length < retryIndexes.length) {
    for (let index = items.length; index < retryIndexes.length; index += 1) {
      const slotIndex = retryIndexes[index];
      const current = nextImages[slotIndex];
      if (!current) {
        continue;
      }
      nextImages[slotIndex] = {
        ...current,
        status: "error",
        error: "未返回足够数量的图片",
      };
    }
  }

  return nextImages;
}

export function countFailures(images: StoredImage[]) {
  return images.filter((image) => image.status === "error").length;
}



export function humanizeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.failureKind === "accepted_pending") {
      return "任务已提交到上游，当前仍在处理中。建议稍后继续等待，而不是立即重新提交。";
    }
    if (error.failureKind === "result_fetch_failed") {
      return "图片结果已就绪，但下载失败。";
    }
    if (error.failureKind === "source_invalid") {
      return "上游未识别到源图，请重新上传源图后重试。";
    }
    if (error.failureKind === "account_blocked") {
      return "当前账号不可用、已限流或授权失效，请切换账号或稍后再试。";
    }
    if (error.failureKind === "input_blocked") {
      return "请修改提示词后重试。";
    }
    if (error.failureKind === "submit_failed") {
      return "图片请求提交失败，请稍后重新提交。";
    }
  }
  const raw = error instanceof Error ? error.message : String(error ?? "处理图片失败");
  const lower = raw.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return "网络连接失败，请检查网络或服务是否正常运行";
  }
  if (lower.includes("暂无可用账号")) {
    return raw;
  }
  if (lower.includes("no available tokens") || lower.includes("accounts.json")) {
    return "暂无可用账号，请先在账号管理页面添加并启用账号";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("超时")) {
    return "请求超时，图像生成耗时较长，请稍后重试";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "请求过于频繁，请稍后再试";
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("token") && lower.includes("invalid")) {
    return "账号授权已失效，请在账号管理页面刷新账号状态";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "无访问权限，账号可能被限制使用";
  }
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("service unavailable")) {
    return "上游服务暂时不可用，请稍后重试";
  }
  if (lower.includes("content policy") || lower.includes("safety") || lower.includes("违规")) {
    return "提示词可能违反内容政策，请修改后重试";
  }
  return raw;
}

export function isCanceledRequestError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "CanceledError" || error.name === "AbortError" || error.message.toLowerCase().includes("canceled"))
  );
}

export function extractRequestFailureMeta(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return {
      failureKind: undefined,
      retryAction: undefined,
      retryable: undefined,
      stage: undefined,
      upstreamConversationId: undefined,
      upstreamResponseId: undefined,
      imageGenerationCallId: undefined,
      sourceAccountId: undefined,
      fileIds: undefined,
    };
  }
  return {
    failureKind: error.failureKind,
    retryAction: error.retryAction,
    retryable: error.retryable,
    stage: error.stage,
    upstreamConversationId: error.upstreamConversationId,
    upstreamResponseId: error.upstreamResponseId,
    imageGenerationCallId: error.imageGenerationCallId,
    sourceAccountId: error.sourceAccountId,
    fileIds: error.fileIds,
  };
}




