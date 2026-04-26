import { NextRequest } from "next/server";

import { getSavedConfig, setSavedConfig } from "@/server/config-store";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

function sanitizeConfig(value: Record<string, unknown>) {
  const next = { ...value };
  delete next.image;
  delete next.app;
  delete next.server;
  delete next.log;

  if (next.chatgpt && typeof next.chatgpt === "object") {
    const nextChatgpt = { ...(next.chatgpt as Record<string, unknown>) };
    delete nextChatgpt.timeout;
    next.chatgpt = nextChatgpt;
  }

  return next;
}

export async function GET(request: NextRequest) {
  try {

    const saved = getSavedConfig();
    if (saved) {
      return jsonOk(sanitizeConfig(saved as Record<string, unknown>));
    }

    return jsonOk({
      chatgpt: {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        apiStyle: "v1",
        responsesModel: "gpt-5.5",
      },
      accounts: {
        defaultQuota: 50,
        autoRefresh: true,
        refreshInterval: 5,
      },
      sync: { enabled: false, provider: "codex", direction: "both", interval: 300 },
      proxy: { enabled: false, url: "" },
      cpa: { enabled: false, baseUrl: "", managementKey: "", providerType: "codex" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sanitized = sanitizeConfig(body);
    setSavedConfig(sanitized);
    return jsonOk(sanitized);
  } catch (error) {
    return jsonError(error);
  }
}
