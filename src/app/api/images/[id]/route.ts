import { NextRequest } from "next/server";

import { readImageFileBytes } from "@/server/repositories/image/file-repository";
import { logger } from "@/server/logger";
import { ApiError, jsonError } from "@/server/response";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await readImageFileBytes(id);
    if (!result) {
      logger.warn("images.file.route", "image-file:not-found", {
        imageId: id,
      });
      throw new ApiError(404, "image not found");
    }
    logger.info("images.file.route", "image-file:served", {
      imageId: id,
      mimeType: result.record.mime_type,
      sizeBytes: result.bytes.length,
      filePath: result.record.file_path,
    });
    return new Response(result.bytes, {
      headers: {
        "Content-Type": result.record.mime_type,
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    logger.error("images.file.route", "image-file:serve-failed", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : typeof error,
    });
    return jsonError(error);
  }
}
