import { NextRequest } from "next/server";

import { readImageFileBytes } from "@/server/image-file-store";
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
      throw new ApiError(404, "image not found");
    }
    return new Response(result.bytes, {
      headers: {
        "Content-Type": result.record.mime_type,
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
