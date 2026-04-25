import { getDb } from "@/server/db";

/**
 * SQLite-backed runtime config store.
 * 设置页保存后会写入 data/eidos.db，不再随 Node.js 进程重启丢失。
 */

type ConfigStore = {
    sync?: {
        enabled?: boolean;
        provider?: string;
        [key: string]: unknown;
    };
    cpa?: {
        enabled?: boolean;
        baseUrl?: string;
        managementKey?: string;
        providerType?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};

const CONFIG_KEY = "runtime";

export function getSavedConfig(): ConfigStore | null {
    const row = getDb()
        .prepare("SELECT value_json FROM app_config WHERE key = ?")
        .get(CONFIG_KEY) as { value_json?: string } | undefined;
    if (!row?.value_json) {
        return null;
    }
    try {
        const parsed = JSON.parse(row.value_json) as ConfigStore;
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

export function setSavedConfig(value: Record<string, unknown>): void {
    getDb()
        .prepare(`
            INSERT INTO app_config (key, value_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
        `)
        .run(CONFIG_KEY, JSON.stringify(value), new Date().toISOString());
}
