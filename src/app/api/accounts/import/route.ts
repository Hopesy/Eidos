import { NextRequest } from "next/server";

import { requireAuthKey } from "@/server/auth";
import { addAccounts, ensureAccountWatcherStarted, refreshAccounts } from "@/server/account-service";
import { ApiError, jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";

/**
 * 从文件文本中提取 access_token 列表，支持多种格式：
 * 1. JSON 数组：["eyJ...", ...]
 * 2. JSON 对象：{ tokens: [...] } 或 { access_tokens: [...] } 或 { access_token: "..." }
 * 3. 纯文本：每行一个 token（ey 开头的 JWT 或其他长字符串）
 * 4. 键值对文本：access_token=eyJ... 或 token=eyJ...（每行）
 */
function extractTokens(raw: string): string[] {
    const text = raw.trim();

    // 1 & 2：尝试 JSON 解析
    if (text.startsWith("{") || text.startsWith("[")) {
        try {
            const parsed = JSON.parse(text) as unknown;
            if (Array.isArray(parsed)) {
                return (parsed as unknown[])
                    .map((item) => String(item || "").trim())
                    .filter((t) => t.length > 8);
            }
            if (parsed && typeof parsed === "object") {
                const obj = parsed as Record<string, unknown>;
                const candidates = obj.tokens ?? obj.access_tokens ?? obj.access_token ?? [];
                if (Array.isArray(candidates)) {
                    return (candidates as unknown[])
                        .map((item) => String(item || "").trim())
                        .filter((t) => t.length > 8);
                }
                // 单个 token 字段
                if (typeof candidates === "string" && candidates.length > 8) {
                    return [candidates.trim()];
                }
            }
            return [];
        } catch {
            // 不是有效 JSON，继续尝试纯文本解析
        }
    }

    // 3 & 4：逐行解析
    const tokens: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // 键值对格式：access_token=xxx 或 token=xxx
        const kvMatch = /^(?:access_token|token)\s*=\s*(.+)$/i.exec(trimmed);
        if (kvMatch) {
            const val = kvMatch[1].trim();
            if (val.length > 8) tokens.push(val);
            continue;
        }

        // 纯 token：长度 > 8，不含空格
        if (trimmed.length > 8 && !/\s/.test(trimmed)) {
            tokens.push(trimmed);
        }
    }
    return tokens;
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
            const tokens = extractTokens(text);
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
