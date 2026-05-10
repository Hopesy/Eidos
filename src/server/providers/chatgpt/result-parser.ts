import {
  createImageError,
  isInputBlockedMessage,
  normalizeUpstreamErrorMessage,
} from "@/server/providers/openai/image-errors";

import { cleanToken } from "./result-shared";

export function parseSsePayload(raw: string) {
  const fileIds: string[] = [];
  let conversationId = "";
  const textParts: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      conversationId = String(json.conversation_id || conversationId);
      const nested = json.v;
      if (nested && typeof nested === "object") {
        conversationId = String((nested as Record<string, unknown>).conversation_id || conversationId);
      }
      for (const fileId of extractImageIdsFromPayload(json)) {
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      }
      const message = (json.message as Record<string, unknown> | undefined) ?? {};
      const content = (message.content as Record<string, unknown> | undefined) ?? {};
      if (content.content_type === "text" && Array.isArray(content.parts) && content.parts.length > 0) {
        textParts.push(String(content.parts[0] || ""));
      }
    } catch {
      continue;
    }
  }

  return {
    conversationId,
    fileIds,
    text: textParts.join(""),
  };
}

function normalizeAssetPointer(pointer: string) {
  if (pointer.startsWith("file-service://")) {
    return pointer.replace("file-service://", "");
  }
  if (pointer.startsWith("sediment://")) {
    return `sed:${pointer.replace("sediment://", "")}`;
  }
  return "";
}

function extractImageIdsFromMessage(message: unknown) {
  const record = (message ?? {}) as Record<string, unknown>;
  const author = (record.author ?? {}) as Record<string, unknown>;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const content = (record.content ?? {}) as Record<string, unknown>;

  if (author.role !== "tool" || metadata.async_task_type !== "image_gen" || content.content_type !== "multimodal_text") {
    return [] as string[];
  }

  const fileIds: string[] = [];
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    const pointer = String((part as Record<string, unknown>)?.asset_pointer || "");
    const fileId = normalizeAssetPointer(pointer);
    if (fileId && !fileIds.includes(fileId)) {
      fileIds.push(fileId);
    }
  }
  return fileIds;
}

function extractImageIdsFromPayload(payload: Record<string, unknown>) {
  const candidates = [
    payload.message,
    (payload.v as Record<string, unknown> | undefined)?.message,
    payload.v,
  ];
  const fileIds: string[] = [];
  for (const candidate of candidates) {
    for (const fileId of extractImageIdsFromMessage(candidate)) {
      if (!fileIds.includes(fileId)) {
        fileIds.push(fileId);
      }
    }
  }
  return fileIds;
}

export function buildNoImageReturnedError(textReply: string) {
  const normalized = cleanToken(textReply);
  const lower = normalized.toLowerCase();
  if (isInputBlockedMessage(normalized)) {
    return createImageError(normalizeUpstreamErrorMessage(normalized), {
      kind: "input_blocked",
      retryAction: "revise_input",
      retryable: false,
      stage: "submit",
    });
  }
  if (
    lower.includes("upload") ||
    lower.includes("please upload") ||
    normalized.includes("请上传") ||
    normalized.includes("源图")
  ) {
    return createImageError("上游未识别到上传源图，未返回图片结果", {
      kind: "source_invalid",
      retryAction: "resubmit",
      retryable: false,
      stage: "submit",
    });
  }
  return createImageError("上游未返回图片结果", {
    kind: "accepted_pending",
    retryAction: "resume_polling",
    retryable: true,
    stage: "poll",
  });
}

export function extractImageIds(mapping: Record<string, unknown>) {
  const fileIds: string[] = [];
  for (const node of Object.values(mapping)) {
    const message = ((node as Record<string, unknown> | undefined)?.message ?? {}) as Record<string, unknown>;
    for (const fileId of extractImageIdsFromMessage(message)) {
      if (fileId && !fileIds.includes(fileId)) {
        fileIds.push(fileId);
      }
    }
  }
  return fileIds;
}
