import { NextRequest } from "next/server";

import { addImageFavorite, listImageFavorites } from "@/server/repositories/image/favorite-repository";
import { imageFavoriteBodySchema, parseJsonBody } from "@/server/request-validation";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return jsonOk({ items: listImageFavorites() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody(request, imageFavoriteBodySchema);
    return jsonOk({ item: addImageFavorite(body) });
  } catch (error) {
    return jsonError(error);
  }
}
