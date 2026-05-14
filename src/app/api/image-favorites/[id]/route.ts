import { NextRequest } from "next/server";

import { deleteImageFavorite, getImageFavorite } from "@/server/repositories/image/favorite-repository";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const item = getImageFavorite(id);
    if (!item) {
      throw new ApiError(404, "favorite not found");
    }
    return jsonOk({ item });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonOk(deleteImageFavorite(id));
  } catch (error) {
    return jsonError(error);
  }
}
