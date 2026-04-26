import { NextRequest } from "next/server";

import { clearImageConversationRecords, listImageConversationRecords, saveImageConversationRecord } from "@/server/image-conversation-store";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return jsonOk({ items: await listImageConversationRecords() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return jsonOk({ item: await saveImageConversationRecord(body) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return jsonOk(await clearImageConversationRecords());
  } catch (error) {
    return jsonError(error);
  }
}

