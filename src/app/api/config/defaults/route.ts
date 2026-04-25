import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        await requireAuthKey(request);

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
