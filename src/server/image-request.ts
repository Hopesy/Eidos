import { ApiError } from "@/server/response";

export const MAX_IMAGE_COUNT = 8;

export function parseImageCount(rawValue: unknown, maxCount = MAX_IMAGE_COUNT) {
  const count = Number(rawValue ?? 1);
  if (!Number.isInteger(count)) {
    throw new ApiError(400, "n must be an integer");
  }
  if (count < 1 || count > maxCount) {
    throw new ApiError(400, `n must be between 1 and ${maxCount}`);
  }
  return count;
}
