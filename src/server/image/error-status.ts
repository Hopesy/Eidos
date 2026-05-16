import type { ImageGenerationError } from "@/server/providers/openai-client";

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
  if (error.kind === "accepted_pending") {
    return 425;
  }
  return 502;
}
