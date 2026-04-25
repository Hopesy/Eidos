import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { clearImageConversationRecords, listImageConversationRecords, saveImageConversationRecord } from "@/server/image-conversation-store";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuthKey(request);
    return jsonOk({ items: await listImageConversationRecords() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const body = (await request.json()) as Record<string, unknown>;
    return jsonOk({ item: await saveImageConversationRecord(body) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAuthKey(request);
    return jsonOk(await clearImageConversationRecords());
  } catch (error) {
    return jsonError(error);
  }
}

