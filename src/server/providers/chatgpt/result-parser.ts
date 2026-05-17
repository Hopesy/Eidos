import {
  createImageError,
  isInputBlockedMessage,
  normalizeUpstreamErrorMessage,
} from "@/server/providers/openai/image-errors";

import { cleanToken } from "./result-shared";

export function parseSsePayload(raw: string) {
  const fileIds: string[] = [];
  let conversationId = "";
  let parentMessageId = "";
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
      const message = (json.message as Record<string, unknown> | undefined) ??
        ((nested as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined) ??
        {};
      parentMessageId = String(message.id || parentMessageId);
      for (const fileId of extractImageIdsFromPayload(json)) {
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      }
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
    parentMessageId,
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

export function isImageGenerationRefusalTitle(title: unknown) {
  const normalized = cleanToken(title).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("图像生成请求拒绝") ||
    normalized.includes("图像生成请求被拒绝") ||
    normalized.includes("图片生成请求拒绝") ||
    normalized.includes("图片生成请求被拒绝") ||
    normalized.includes("image generation request rejected") ||
    normalized.includes("image generation request refused") ||
    normalized.includes("image generation request declined")
  );
}

function extractImageIdsFromMessage(message: unknown) {
  const record = (message ?? {}) as Record<string, unknown>;
  const author = (record.author ?? {}) as Record<string, unknown>;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const content = (record.content ?? {}) as Record<string, unknown>;

  if (content.content_type !== "multimodal_text") {
    return [] as string[];
  }

  const role = typeof author.role === "string" ? author.role : "";
  if (role !== "tool" && role !== "assistant") {
    return [] as string[];
  }

  const isImageGenerationToolMessage = role === "tool" && metadata.async_task_type === "image_gen";
  const fileIds: string[] = [];
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const partRecord = part as Record<string, unknown>;
    const pointer = String(partRecord.asset_pointer || "");
    const fileId = normalizeAssetPointer(pointer);
    const isGeneratedImagePointer = pointer.startsWith("sediment://");
    if (!isImageGenerationToolMessage && !isGeneratedImagePointer) {
      continue;
    }
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
  return extractImageResult(mapping).fileIds;
}

export function extractAssistantText(mapping: Record<string, unknown>) {
  let latest = "";
  let latestCreate = -Infinity;
  for (const node of Object.values(mapping)) {
    const message = ((node as Record<string, unknown> | undefined)?.message ?? {}) as Record<string, unknown>;
    const author = (message.author ?? {}) as Record<string, unknown>;
    const content = (message.content ?? {}) as Record<string, unknown>;
    if (author.role !== "assistant") {
      continue;
    }
    // assistant messages can be plain text or multimodal_text (image + text mixed). Refusal
    // copy may live in either, so scan both — multimodal parts can be objects with a `text`
    // field while plain text parts are usually strings.
    const isPlainText = content.content_type === "text";
    const isMultimodal = content.content_type === "multimodal_text";
    if (!isPlainText && !isMultimodal) {
      continue;
    }
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const value = (part as Record<string, unknown>).text;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .join("")
      .trim();
    if (!text) {
      continue;
    }
    const createTime = Number(message.create_time ?? 0);
    if (createTime >= latestCreate) {
      latestCreate = createTime;
      latest = text;
    }
  }
  return latest;
}

// In multi-turn conversations the mapping keeps every previous tool message that produced an
// image. If we accept all of them, polling the conversation after a brand new prompt will return
// the previous turn's sediment file ids and the runner will "successfully" download yesterday's
// image as today's result. Group messages by adjacency in create_time so that all messages in
// the current turn — even multi-image turns whose parts streamed minutes apart — stay
// together, while historical turns separated by a meaningful gap are dropped.
//
// The threshold is set well above the typical multi-image generation latency (a few seconds to
// a minute) so we never drop a real image, while staying small enough to exclude prior turns
// that the user almost certainly waited longer than this to submit again.
const TURN_GAP_MS = 3 * 60_000;

export type ExtractImageResultOptions = {
  // Drop any tool message whose create_time is strictly older than this baseline. The caller
  // sets this to "shortly before submit time" so polling cannot mistake a stale tool message
  // from a previous turn (which is the only data on the mapping while the new image is still
  // generating) for the current turn's result.
  minCreateTimeMs?: number;
};

export function extractImageResult(
  mapping: Record<string, unknown>,
  options: ExtractImageResultOptions = {},
) {
  type Candidate = {
    messageId: string;
    createTimeMs: number;
    fileIds: string[];
  };
  const candidates: Candidate[] = [];
  const minCreateTimeMs = options.minCreateTimeMs;

  for (const node of Object.values(mapping)) {
    const message = ((node as Record<string, unknown> | undefined)?.message ?? {}) as Record<string, unknown>;
    const messageFileIds = extractImageIdsFromMessage(message);
    if (messageFileIds.length === 0) {
      continue;
    }
    const rawCreate = Number(message.create_time ?? 0);
    // ChatGPT serializes create_time in seconds; coerce to ms for comparable arithmetic.
    const createTimeMs = Number.isFinite(rawCreate) ? rawCreate * 1000 : 0;
    // Strictly older than the submit baseline → definitely a previous turn. Keep candidates
    // with createTimeMs === 0 (missing/unparseable timestamp) so legitimate images are never
    // dropped just because the field is absent.
    if (typeof minCreateTimeMs === "number" && createTimeMs > 0 && createTimeMs < minCreateTimeMs) {
      continue;
    }
    candidates.push({
      messageId: cleanToken(message.id),
      createTimeMs,
      fileIds: messageFileIds,
    });
  }

  if (candidates.length === 0) {
    return { fileIds: [] as string[], parentMessageId: "" };
  }

  // Sort newest first so we can walk down until we hit a gap that separates the current turn
  // from the previous one. Messages with missing/unparseable create_time are kept (they sort to
  // 0 and stay clustered together) so that we never lose images just because the timestamp is
  // absent.
  const sorted = candidates.slice().sort((a, b) => b.createTimeMs - a.createTimeMs);
  const latestBatch: Candidate[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const previousKept = latestBatch[latestBatch.length - 1];
    const gap = previousKept.createTimeMs - sorted[index].createTimeMs;
    if (gap > TURN_GAP_MS) {
      break;
    }
    latestBatch.push(sorted[index]);
  }

  const fileIds: string[] = [];
  let parentMessageId = "";
  // Walk the batch in chronological order so the newest message wins for parentMessageId.
  latestBatch
    .slice()
    .sort((a, b) => a.createTimeMs - b.createTimeMs)
    .forEach((candidate) => {
      if (candidate.messageId) {
        parentMessageId = candidate.messageId;
      }
      for (const fileId of candidate.fileIds) {
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      }
    });

  return { fileIds, parentMessageId };
}
