import { NextRequest } from "next/server";

import { clearImageConversationRecords, listImageConversationRecords, saveImageConversationRecord } from "@/server/repositories/image/conversation-repository";
import { parseJsonBody, recordBodySchema } from "@/server/request-validation";
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
    const body = await parseJsonBody(request, recordBodySchema);
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
