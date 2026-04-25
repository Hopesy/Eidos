import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        await requireAuthKey(request);

        return jsonOk({
            app: { authKey: "" },
            server: { host: "0.0.0.0", port: 3000 },
            chatgpt: { baseUrl: "https://chatgpt.com", timeout: 60000 },
            accounts: {
                defaultQuota: 50,
                autoRefresh: true,
                refreshInterval: 5,
            },
            storage: { type: "sqlite", path: "data/eidos.db" },
            sync: { enabled: false, provider: "codex", direction: "both", interval: 300 },
            proxy: { enabled: false, url: "" },
            cpa: { enabled: false, baseUrl: "" },
            log: { level: "info", maxItems: 500 },
            paths: { data: "data/eidos.db", logs: "logs", images: "data/images", uploads: "data/uploads" },
        });
    } catch (error) {
        return jsonError(error);
    }
}
