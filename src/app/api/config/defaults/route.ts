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
            chatgpt: { baseUrl: "https://chatgpt.com", timeout: 180 },
            accounts: {
                defaultQuota: 50,
                autoRefresh: true,
                refreshInterval: 5,
            },
            storage: { type: "json", path: "data" },
            sync: { enabled: false },
            proxy: { enabled: false, url: "" },
            cpa: { enabled: false, baseUrl: "" },
            log: { level: "info", maxItems: 500 },
            paths: { data: "data", logs: "logs" },
        });
    } catch (error) {
        return jsonError(error);
    }
}
