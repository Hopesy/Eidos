import { generateWithPool } from "@/server/account-service";
import { parseImageCount } from "@/server/image/request";
import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import { ApiError } from "@/server/response";

const IMAGE_MODELS = new Set(["gpt-image-1", "gpt-image-2"]);

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
    return body.tools.some(
      (tool) => tool && typeof tool === "object" && String((tool as Record<string, unknown>).type || "").trim() === "image_generation",
    );
  }
  if (body.tool_choice && typeof body.tool_choice === "object") {
    return String((body.tool_choice as Record<string, unknown>).type || "").trim() === "image_generation";
  }
  return false;
}

function buildChatImageCompletion(model: string, imageResult: { created: number; data: Array<Record<string, unknown>> }) {
  const markdownImages = imageResult.data
    .map((item, index) => {
      const b64 = String(item.b64_json || "").trim();
      return b64 ? `![image_${index + 1}](data:image/png;base64,${b64})` : "";
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

export async function createChatCompletion(body: Record<string, unknown>) {
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

  try {
    return buildChatImageCompletion(model, await generateWithPool(prompt, model, count));
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

export async function createResponse(body: Record<string, unknown>) {
  if (body.stream) {
    throw new ApiError(400, "stream is not supported");
  }
  if (!hasResponseImageGenerationTool(body)) {
    throw new ApiError(400, "only image_generation tool requests are supported on this endpoint");
  }

  const prompt = extractResponsePrompt(body.input);
  if (!prompt) {
    throw new ApiError(400, "input text is required");
  }

  try {
    const result = await generateWithPool(prompt, "gpt-image-1", 1);
    const output = result.data
      .map((item, index) => {
        const b64 = String(item.b64_json || "").trim();
        if (!b64) {
          return null;
        }
        return {
          id: `ig_${index + 1}`,
          type: "image_generation_call",
          status: "completed",
          result: b64,
          revised_prompt: String(item.revised_prompt || prompt).trim(),
        };
      })
      .filter(Boolean);

    if (output.length === 0) {
      throw new ApiError(502, "image generation failed");
    }

    return {
      id: `resp_${result.created}`,
      object: "response",
      created_at: result.created,
      status: "completed",
      error: null,
      incomplete_details: null,
      model: String(body.model || "gpt-5").trim() || "gpt-5",
      output,
      parallel_tool_calls: false,
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
