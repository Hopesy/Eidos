import { httpRequest } from "@/lib/request";

import type {
  ImageGenerationQuality,
  ImageGenerationSize,
  ImageModel,
  ImageResponseItem,
  InpaintSourceReference,
  RecoverableImageTaskItem,
} from "../types";

export async function generateImage(
  prompt: string,
  model: ImageModel = "gpt-image-1",
  count = 1,
  options: {
    size?: ImageGenerationSize;
    quality?: ImageGenerationQuality;
    signal?: AbortSignal;
  } = {},
) {
  const { size = "auto", quality = "auto", signal } = options;
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/generations",
    {
      method: "POST",
      body: {
        prompt,
        model,
        n: count,
        response_format: "b64_json",
        size,
        quality,
      },
      signal,
    },
  );
}

export async function editImage(params: {
  prompt: string;
  images: File[];
  mask?: File | null;
  sourceReference?: InpaintSourceReference | null;
  model?: ImageModel;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  signal?: AbortSignal;
}) {
  const {
    prompt,
    images,
    mask,
    sourceReference,
    model = "gpt-image-1",
    size,
    quality,
    signal,
  } = params;
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("model", model);
  formData.append("response_format", "b64_json");
  if (size) {
    formData.append("size", size);
  }
  if (quality) {
    formData.append("quality", quality);
  }
  images.forEach((image) => formData.append("image", image));
  if (mask) {
    formData.append("mask", mask);
  }
  if (sourceReference) {
    formData.append("original_file_id", sourceReference.original_file_id);
    formData.append("original_gen_id", sourceReference.original_gen_id);
    if (sourceReference.previous_response_id) {
      formData.append("previous_response_id", sourceReference.previous_response_id);
    }
    if (sourceReference.image_generation_call_id) {
      formData.append(
        "image_generation_call_id",
        sourceReference.image_generation_call_id,
      );
    }
    if (sourceReference.conversation_id) {
      formData.append("conversation_id", sourceReference.conversation_id);
    }
    if (sourceReference.parent_message_id) {
      formData.append("parent_message_id", sourceReference.parent_message_id);
    }
    formData.append("source_account_id", sourceReference.source_account_id);
  }
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
      signal,
    },
  );
}

export async function upscaleImage(params: {
  image: File;
  prompt?: string;
  quality?: ImageGenerationQuality;
  model?: ImageModel;
  signal?: AbortSignal;
}) {
  const { image, prompt, quality, model = "gpt-image-1", signal } = params;
  const formData = new FormData();
  formData.append("image", image);
  formData.append("model", model);
  formData.append("response_format", "b64_json");
  if (prompt !== undefined) {
    formData.append("prompt", prompt);
  }
  if (quality) {
    formData.append("quality", quality);
  }
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/upscale",
    {
      method: "POST",
      body: formData,
      signal,
    },
  );
}

export async function recoverImageTask(params: {
  conversationId: string;
  sourceAccountId?: string;
  revisedPrompt?: string;
  fileIds?: string[];
  waitMs?: number;
  model: ImageModel;
  mode: "generate" | "edit" | "upscale";
  signal?: AbortSignal;
}) {
  const { signal, ...body } = params;
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/api/image-tasks/recover",
    {
      method: "POST",
      body,
      signal,
    },
  );
}

export async function fetchRecoverableImageTasks(limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) }).toString();
  return httpRequest<{ items: RecoverableImageTaskItem[] }>(
    `/api/image-tasks/recover?${query}`,
  );
}
