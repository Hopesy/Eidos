import { NextRequest } from "next/server";

import { deleteImageConversationRecord, getImageConversationRecord, saveImageConversationRecord } from "@/server/image-conversation-store";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const item = await getImageConversationRecord(id);
    if (!item) {
      throw new ApiError(404, "conversation not found");
    }
    return jsonOk({ item });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return jsonOk({ item: await saveImageConversationRecord({ ...body, id }) });
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
    return jsonOk(await deleteImageConversationRecord(id));
  } catch (error) {
    return jsonError(error);
  }
}

