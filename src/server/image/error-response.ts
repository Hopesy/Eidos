import { getImageErrorMeta, ImageGenerationError } from "@/server/providers/openai-client";
import { ApiError } from "@/server/response";
import { resolveImageErrorStatus } from "@/server/image/error-status";

export { resolveImageErrorStatus } from "@/server/image/error-status";

export function createImageApiError(error: ImageGenerationError) {
  return new ApiError(resolveImageErrorStatus(error), error.message, {
    error: error.message,
    ...getImageErrorMeta(error),
  });
}
