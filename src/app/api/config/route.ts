import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { getRuntimeConfig } from "@/server/config";
import { getSavedConfig, setSavedConfig } from "@/server/config-store";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAuthKey(request);

    const saved = getSavedConfig();
    if (saved) {
      return jsonOk(saved);
    }

    // Build a default config from runtime values
    const runtime = await getRuntimeConfig();
    return jsonOk({
      app: { authKey: runtime.authKey ? "***" : "" },
      server: { host: runtime.host, port: runtime.port },
      chatgpt: { baseUrl: "https://chatgpt.com", timeout: 60000 },
      accounts: {
        defaultQuota: 50,
        autoRefresh: true,
        refreshInterval: runtime.refreshAccountIntervalMinute,
      },
      storage: { type: "sqlite", path: "data/eidos.db" },
      sync: { enabled: false, provider: "codex", direction: "both", interval: 300 },
      proxy: { enabled: false, url: "" },
      cpa: { enabled: false, baseUrl: "", managementKey: "", providerType: "codex" },
      log: { level: "info", maxItems: 500 },
      paths: { data: "data/eidos.db", logs: "logs", images: "data/images", uploads: "data/uploads" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const body = (await request.json()) as Record<string, unknown>;
    setSavedConfig(body);
    return jsonOk(body);
  } catch (error) {
    return jsonError(error);
  }
}
