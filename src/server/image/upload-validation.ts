import { ApiError } from "@/server/response";

export const MAX_EDIT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_PREFIX = "image/";

export function validateUploadedImages(
  images: File[],
  options: { maxCount?: number; maxBytes?: number; field?: string } = {},
) {
  const maxCount = options.maxCount ?? MAX_EDIT_IMAGES;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const field = options.field ?? "image";
  if (images.length > maxCount) {
    throw new ApiError(400, `too many ${field} files: max ${maxCount}, got ${images.length}`);
  }
  images.forEach((file, index) => {
    if (file.size > maxBytes) {
      throw new ApiError(
        413,
        `${field}[${index}] exceeds max size ${Math.floor(maxBytes / 1024 / 1024)}MB: ${file.size} bytes`,
      );
    }
    const mime = String(file.type || "").trim().toLowerCase();
    if (mime && !mime.startsWith(ALLOWED_IMAGE_MIME_PREFIX)) {
      throw new ApiError(400, `${field}[${index}] must be an image, got ${mime}`);
    }
  });
}

export function validateMaskFile(mask: File | null | undefined, maxBytes = MAX_IMAGE_BYTES) {
  if (!mask) {
    return;
  }
  validateUploadedImages([mask], { maxCount: 1, maxBytes, field: "mask" });
}
