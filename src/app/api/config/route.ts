import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { getRuntimeConfig } from "@/server/config";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

// In-memory config store (persists across requests within the same process)
let savedConfig: Record<string, unknown> | null = null;

export async function GET(request: NextRequest) {
  try {
    await requireAuthKey(request);

    if (savedConfig) {
      return jsonOk(savedConfig);
    }

    // Build a default config from runtime values
    const runtime = await getRuntimeConfig();
    return jsonOk({
      app: { authKey: runtime.authKey ? "***" : "" },
      server: { host: runtime.host, port: runtime.port },
      chatgpt: { baseUrl: "https://chatgpt.com", timeout: 180 },
      accounts: {
        defaultQuota: 50,
        autoRefresh: true,
        refreshInterval: runtime.refreshAccountIntervalMinute,
      },
      storage: { type: "json", path: "data" },
      sync: { enabled: false },
      proxy: { enabled: false },
      cpa: { enabled: false },
      log: { level: "info", maxItems: 500 },
      paths: { data: "data", logs: "logs" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAuthKey(request);
    const body = (await request.json()) as Record<string, unknown>;
    savedConfig = body;
    return jsonOk(savedConfig);
  } catch (error) {
    return jsonError(error);
  }
}
