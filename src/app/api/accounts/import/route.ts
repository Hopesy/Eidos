import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { addAccounts, ensureAccountWatcherStarted, refreshAccounts } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

function extractTokensFromJson(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item || "").trim()).filter(Boolean);
        }
        if (parsed && typeof parsed === "object") {
            const candidates = parsed.tokens ?? parsed.access_tokens ?? [];
            if (Array.isArray(candidates)) {
                return candidates.map((item: unknown) => String(item || "").trim()).filter(Boolean);
            }
        }
        return [];
    } catch {
        return [];
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireAuthKey(request);
        await ensureAccountWatcherStarted();

        const formData = await request.formData();
        const files = formData.getAll("file");

        if (files.length === 0) {
            throw new ApiError(400, "at least one file is required");
        }

        const allTokens: string[] = [];
        let importedFiles = 0;

        for (const entry of files) {
            if (!(entry instanceof File)) {
                continue;
            }
            const text = await entry.text();
            const tokens = extractTokensFromJson(text);
            allTokens.push(...tokens);
            importedFiles += 1;
        }

        const unique = [...new Set(allTokens)].filter(Boolean);
        if (unique.length === 0) {
            throw new ApiError(400, "no valid tokens found in uploaded files");
        }

        const addResult = await addAccounts(unique);
        const refreshResult = await refreshAccounts(unique);

        return jsonOk({
            items: refreshResult.items.length > 0 ? refreshResult.items : addResult.items,
            imported: addResult.added ?? 0,
            imported_files: importedFiles,
            refreshed: refreshResult.refreshed,
            errors: refreshResult.errors,
            duplicates: [],
            failed: [],
        });
    } catch (error) {
        return jsonError(error);
    }
}
