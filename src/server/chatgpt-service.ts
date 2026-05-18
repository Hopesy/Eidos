import { editImage, generateWithPool } from "@/server/account-service";
import { parseImageCount } from "@/server/image/request";
import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import {
  imageOutputFormatSchema,
  imageQualitySchema,
  imageSizeSchema,
} from "@/server/request-validation";
import { ApiError } from "@/server/response";
import { normalizeImageOutputFormat } from "@/shared/image-generation";
import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";

const IMAGE_MODELS = new Set(["gpt-image-1", "gpt-image-2"]);

const OUTPUT_FORMAT_MIME: Record<ImageOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i;

function extractPromptFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const part = item as Record<string, unknown>;
      if (part.type === "text") {
        return String(part.text || "").trim();
      }
      if (part.type === "input_text") {
        return String(part.text || part.input_text || "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractChatPrompt(body: Record<string, unknown>) {
  const directPrompt = String(body.prompt || "").trim();
  if (directPrompt) {
    return directPrompt;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") {
        return "";
      }
      const current = message as Record<string, unknown>;
      if (String(current.role || "").trim().toLowerCase() !== "user") {
        return "";
      }
      return extractPromptFromMessageContent(current.content);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractResponsePrompt(input: unknown): string {
  if (typeof input === "string") {
    return input.trim();
  }

  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const current = item as Record<string, unknown>;
        if (current.type === "input_text") {
          return String(current.text || "").trim();
        }
        if (current.role && String(current.role).trim().toLowerCase() !== "user") {
          return "";
        }
        return extractPromptFromMessageContent(current.content);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (input && typeof input === "object") {
    const current = input as Record<string, unknown>;
    if (current.role && String(current.role).trim().toLowerCase() !== "user") {
      return "";
    }
    return extractPromptFromMessageContent(current.content);
  }

  return "";
}

function dataUrlToFile(dataUrl: string, index: number): File | null {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) {
    return null;
  }
  const mime = match[1].toLowerCase();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  const ext = mime.includes("jpeg") || mime.includes("jpg")
    ? ".jpg"
    : mime.includes("webp")
      ? ".webp"
      : ".png";
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new File([ab], `input-image-${index + 1}${ext}`, { type: mime });
}

type ResponseInputResult = {
  prompt: string;
  images: File[];
  imageGenerationCallId?: string;
  unsupported: string[];
};

function collectInputImagesFromContent(content: unknown, images: File[], unsupported: string[]) {
  if (!Array.isArray(content)) {
    return;
  }
  content.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const part = item as Record<string, unknown>;
    if (part.type !== "input_image") {
      return;
    }
    const fileId = String(part.file_id || "").trim();
    if (fileId) {
      unsupported.push(`file_id:${fileId}`);
      return;
    }
    const imageUrl = String(part.image_url || "").trim();
    if (!imageUrl) {
      return;
    }
    if (imageUrl.startsWith("data:")) {
      const file = dataUrlToFile(imageUrl, images.length);
      if (file) {
        images.push(file);
      } else {
        unsupported.push("invalid_data_url");
      }
      return;
    }
    unsupported.push(`remote_url:${imageUrl.slice(0, 60)}`);
  });
}

export function extractResponseInput(input: unknown): ResponseInputResult {
  const prompt = extractResponsePrompt(input);
  const images: File[] = [];
  const unsupported: string[] = [];
  let imageGenerationCallId: string | undefined;

  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const current = item as Record<string, unknown>;
    if (current.type === "image_generation_call") {
      const id = String(current.id || "").trim();
      if (id) {
        imageGenerationCallId = id;
      }
      return;
    }
    if (current.type === "input_image") {
      collectInputImagesFromContent([current], images, unsupported);
      return;
    }
    if (Array.isArray(current.content)) {
      collectInputImagesFromContent(current.content, images, unsupported);
    }
  };

  if (Array.isArray(input)) {
    input.forEach(visit);
  } else if (input && typeof input === "object") {
    visit(input);
  }

  return { prompt, images, imageGenerationCallId, unsupported };
}

type ImageGenerationToolConfig = {
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  outputFormat: ImageOutputFormat;
};

function extractImageGenerationToolConfig(body: Record<string, unknown>): ImageGenerationToolConfig {
  const fallback: ImageGenerationToolConfig = { outputFormat: "png" };
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") {
      continue;
    }
    const t = tool as Record<string, unknown>;
    if (String(t.type || "").trim() !== "image_generation") {
      continue;
    }
    const sizeResult = imageSizeSchema.safeParse(t.size);
    const qualityResult = imageQualitySchema.safeParse(t.quality);
    const formatResult = imageOutputFormatSchema.safeParse(t.output_format);
    return {
      size: sizeResult.success ? sizeResult.data : undefined,
      quality: qualityResult.success ? qualityResult.data : undefined,
      outputFormat: formatResult.success ? formatResult.data : normalizeImageOutputFormat(t.output_format),
    };
  }
  return fallback;
}

export function isImageChatRequest(body: Record<string, unknown>) {
  const model = String(body.model || "").trim();
  if (IMAGE_MODELS.has(model)) {
    return true;
  }
  if (Array.isArray(body.modalities)) {
    const modalities = body.modalities.map((item) => String(item || "").trim().toLowerCase());
    return modalities.includes("image");
  }
  return false;
}

export function hasResponseImageGenerationTool(body: Record<string, unknown>) {
  if (Array.isArray(body.tools)) {
    const hasInTools = body.tools.some(
      (tool) => tool && typeof tool === "object" && String((tool as Record<string, unknown>).type || "").trim() === "image_generation",
    );
    if (hasInTools) {
      return true;
    }
  }
  if (body.tool_choice && typeof body.tool_choice === "object") {
    return String((body.tool_choice as Record<string, unknown>).type || "").trim() === "image_generation";
  }
  return false;
}

function buildChatImageCompletion(
  model: string,
  outputFormat: ImageOutputFormat,
  imageResult: { created: number; data: Array<Record<string, unknown>> },
) {
  const mime = OUTPUT_FORMAT_MIME[outputFormat] ?? OUTPUT_FORMAT_MIME.png;
  const markdownImages = imageResult.data
    .map((item, index) => {
      const b64 = String(item.b64_json || "").trim();
      return b64 ? `![image_${index + 1}](data:${mime};base64,${b64})` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: imageResult.created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: markdownImages || "Image generation completed.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export async function createChatCompletion(body: Record<string, unknown>, options: { signal?: AbortSignal } = {}) {
  if (!isImageChatRequest(body)) {
    throw new ApiError(400, "only image generation requests are supported on this endpoint");
  }
  if (body.stream) {
    throw new ApiError(400, "stream is not supported for image generation");
  }

  const model = String(body.model || "gpt-image-1").trim() || "gpt-image-1";
  const count = parseImageCount(body.n);
  const prompt = extractChatPrompt(body);
  if (!prompt) {
    throw new ApiError(400, "prompt is required");
  }
  const outputFormat = normalizeImageOutputFormat(body.output_format);

  try {
    const result = await generateWithPool(prompt, model, count, {
      imageFormat: outputFormat,
      signal: options.signal,
    });
    return buildChatImageCompletion(model, outputFormat, result);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw new ApiError(502, error.message, {
        error: error.message,
        ...getImageErrorMeta(error),
      });
    }
    throw error;
  }
}

function buildResponseOutputItems(
  data: Array<Record<string, unknown>>,
  fallbackPrompt: string,
) {
  return data
    .map((item) => {
      const b64 = String(item.b64_json || "").trim();
      if (!b64) {
        return null;
      }
      return {
        id: `ig_${crypto.randomUUID()}`,
        type: "image_generation_call",
        status: "completed",
        result: b64,
        revised_prompt: String(item.revised_prompt || fallbackPrompt).trim(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export async function createResponse(body: Record<string, unknown>, options: { signal?: AbortSignal } = {}) {
  if (body.stream) {
    throw new ApiError(400, "stream is not supported");
  }
  if (!hasResponseImageGenerationTool(body)) {
    throw new ApiError(400, "only image_generation tool requests are supported on this endpoint");
  }

  const { prompt, images, imageGenerationCallId, unsupported } = extractResponseInput(body.input);
  if (unsupported.length > 0) {
    throw new ApiError(400, `unsupported input items: ${unsupported.join(", ")}`);
  }
  if (!prompt) {
    throw new ApiError(400, "input text is required");
  }

  const toolConfig = extractImageGenerationToolConfig(body);
  const previousResponseId = String(body.previous_response_id || "").trim() || undefined;
  const requestModel = String(body.model || "").trim();
  const parallelToolCalls = body.parallel_tool_calls === true;

  try {
    let data: Array<Record<string, unknown>>;
    let created: number;

    if (images.length > 0) {
      const result = await editImage(prompt, "gpt-image-1", images, null, {
        imageSize: toolConfig.size,
        imageQuality: toolConfig.quality,
        imageFormat: toolConfig.outputFormat,
        sourceReference: previousResponseId || imageGenerationCallId
          ? {
            previousResponseId,
            imageGenerationCallId,
          }
          : null,
        signal: options.signal,
      });
      data = Array.isArray(result.data) ? result.data : [];
      created = Number(result.created || Math.floor(Date.now() / 1000));
    } else {
      const result = await generateWithPool(prompt, "gpt-image-1", 1, {
        imageSize: toolConfig.size,
        imageQuality: toolConfig.quality,
        imageFormat: toolConfig.outputFormat,
        signal: options.signal,
      });
      data = Array.isArray(result.data) ? result.data : [];
      created = Number(result.created || Math.floor(Date.now() / 1000));
    }

    const output = buildResponseOutputItems(data, prompt);
    if (output.length === 0) {
      throw new ApiError(502, "image generation failed");
    }

    return {
      id: `resp_${crypto.randomUUID()}`,
      object: "response",
      created_at: created,
      status: "completed",
      error: null,
      incomplete_details: null,
      model: requestModel || "gpt-5.5",
      output,
      parallel_tool_calls: parallelToolCalls,
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw new ApiError(502, error.message, {
        error: error.message,
        ...getImageErrorMeta(error),
      });
    }
    throw error;
  }
}
