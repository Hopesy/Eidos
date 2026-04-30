import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import { ApiError } from "@/server/response";

export function resolveImageErrorStatus(error: ImageGenerationError) {
  if (error.statusCode === 401) {
    return 401;
  }
  if (error.statusCode === 429) {
    return 429;
  }
  if (error.kind === "input_blocked") {
    return 400;
  }
  return 502;
}

export function createImageApiError(error: ImageGenerationError) {
  return new ApiError(resolveImageErrorStatus(error), error.message, {
    error: error.message,
    ...getImageErrorMeta(error),
  });
}
