import { createHash } from "node:crypto";

import type { SyncRunResult, SyncStatusResponse } from "@/lib/api";
import { addAccounts, listAccounts, refreshAccounts, updateAccount } from "@/server/account-service";
import { getSavedConfig } from "@/server/repositories/config-repository";
import { ApiError } from "@/server/response";
import { getLastSyncRun, saveSyncRun } from "@/server/repositories/sync-run-repository";

const DEFAULT_TIMEOUT_MS = 10_000;

type SavedConfigShape = {
    sync?: {
        enabled?: boolean;
        provider?: string;
    };
    cpa?: {
        enabled?: boolean;
        baseUrl?: string;
        managementKey?: string;
        providerType?: string;
    };
};

type RemoteAuthFileInfo = {
    name: string;
    type?: string;
    provider?: string;
    email?: string;
    disabled?: boolean;
    note?: string;
    priority?: number;
    auth_index?: string;
};

type RemoteAuthPayload = {
    name: string;
    accessToken: string;
    email: string | null;
    disabled: boolean;
    raw: Record<string, unknown>;
    meta: RemoteAuthFileInfo;
};

type LocalAccount = Awaited<ReturnType<typeof listAccounts>>[number];

type CpaConfig = {
    enabled: boolean;
    baseUrl: string;
    managementKey: string;
    providerType: string;
};


function normalizeProvider(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function normalizeToken(value: unknown) {
    return String(value || "").trim();
}

function buildAccountName(accessToken: string) {
    return `${createHash("sha1").update(accessToken).digest("hex").slice(0, 16)}.json`;
}

function isLocalDisabled(account: LocalAccount) {
    return account.status === "禁用";
}

async function getCpaConfig(): Promise<CpaConfig> {
    const savedConfig = getSavedConfig() as SavedConfigShape | null;
    const syncEnabled = Boolean(savedConfig?.sync?.enabled);
    const cpaEnabled = Boolean(savedConfig?.cpa?.enabled);
    const provider = normalizeProvider(savedConfig?.sync?.provider);
    const providerType = String(savedConfig?.cpa?.providerType || provider || process.env.CPA_PROVIDER_TYPE || "codex").trim();
    const baseUrl = String(savedConfig?.cpa?.baseUrl || process.env.CPA_BASE_URL || "").trim().replace(/\/+$/, "");
    const managementKey = String(savedConfig?.cpa?.managementKey || process.env.CPA_MANAGEMENT_KEY || "").trim();

    return {
        enabled: (syncEnabled || cpaEnabled || Boolean(baseUrl)) && Boolean(baseUrl && managementKey),
        baseUrl,
        managementKey,
        providerType,
    };
}

class CpaClient {
    constructor(private readonly config: CpaConfig) { }

    configured() {
        return this.config.enabled && Boolean(this.config.baseUrl) && Boolean(this.config.managementKey);
    }

    private async request(path: string, init: RequestInit = {}) {
        if (!this.configured()) {
            throw new ApiError(400, "CPA sync is not configured");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
            const response = await fetch(`${this.config.baseUrl}${path}`, {
                ...init,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${this.config.managementKey}`,
                    ...(init.headers || {}),
                },
                cache: "no-store",
            });
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new ApiError(504, "CPA 请求超时");
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    private matchesProvider(info: RemoteAuthFileInfo) {
        const expected = normalizeProvider(this.config.providerType);
        if (!expected) {
            return true;
        }
        return [info.type, info.provider].some((value) => normalizeProvider(value) === expected || normalizeProvider(value) === "");
    }

    async listAuthFiles() {
        const response = await this.request("/v0/management/auth-files", {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new ApiError(response.status, `列出 CPA auth-files 失败：${await response.text()}`);
        }

        const payload = (await response.json()) as { files?: RemoteAuthFileInfo[] };
        return (payload.files || []).filter((item) => this.matchesProvider(item));
    }

    async downloadAuthFile(name: string) {
        const response = await this.request(`/v0/management/auth-files/download?name=${encodeURIComponent(name)}`, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        const text = await response.text();
        if (!response.ok) {
            throw new ApiError(response.status, `下载 CPA auth-file 失败：${text}`);
        }
        return text;
    }

    async uploadAuthFile(name: string, content: string) {
        const formData = new FormData();
        formData.append("file", new Blob([content], { type: "application/json" }), name);
        const response = await this.request("/v0/management/auth-files", {
            method: "POST",
            body: formData,
        });
        if (![200, 201, 409].includes(response.status)) {
            throw new ApiError(response.status, `上传 CPA auth-file 失败：${await response.text()}`);
        }
    }

    async patchAuthFileStatus(name: string, disabled: boolean) {
        const response = await this.request("/v0/management/auth-files/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, disabled }),
        });
        if (![200, 204].includes(response.status)) {
            throw new ApiError(response.status, `更新 CPA auth-file 状态失败：${await response.text()}`);
        }
    }
}

async function loadRemoteAuthFiles(client: CpaClient) {
    const files = await client.listAuthFiles();
    const byToken = new Map<string, RemoteAuthPayload>();

    for (const file of files) {
        try {
            const content = await client.downloadAuthFile(file.name);
            const parsed = JSON.parse(content) as Record<string, unknown>;
            const accessToken = normalizeToken(parsed.access_token);
            if (!accessToken) {
                continue;
            }
            byToken.set(accessToken, {
                name: file.name,
                accessToken,
                email: normalizeToken(parsed.email) || file.email || null,
                disabled: Boolean(parsed.disabled ?? file.disabled),
                raw: parsed,
                meta: file,
            });
        } catch {
            continue;
        }
    }

    return byToken;
}

function emptyStatus(configured: boolean, lastRun: SyncRunResult | null): SyncStatusResponse {
    return {
        configured,
        local: 0,
        remote: 0,
        summary: {
            synced: 0,
            pending_upload: 0,
            remote_only: 0,
            remote_deleted: 0,
        },
        accounts: [],
        disabledMismatch: 0,
        lastRun,
    };
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
    const config = await getCpaConfig();
    if (!config.enabled) {
        return emptyStatus(false, getLastSyncRun());
    }

    const client = new CpaClient(config);
    const [localAccounts, remoteMap] = await Promise.all([listAccounts(), loadRemoteAuthFiles(client)]);
    const status = emptyStatus(true, getLastSyncRun());
    status.local = localAccounts.length;
    status.remote = remoteMap.size;

    const localTokenSet = new Set(localAccounts.map((item) => item.access_token));

    for (const account of localAccounts) {
        const remote = remoteMap.get(account.access_token);
        const syncStatus = remote ? "synced" : "pending_upload";
        status.summary[syncStatus] += 1;
        if (remote && remote.disabled !== isLocalDisabled(account)) {
            status.disabledMismatch += 1;
        }
        status.accounts.push({
            name: remote?.name || buildAccountName(account.access_token),
            status: syncStatus,
            location: remote ? "both" : "local",
            localDisabled: isLocalDisabled(account),
            remoteDisabled: remote?.disabled ?? null,
        });
    }

    for (const remote of remoteMap.values()) {
        if (localTokenSet.has(remote.accessToken)) {
            continue;
        }
        status.summary.remote_only += 1;
        status.accounts.push({
            name: remote.name,
            status: "remote_only",
            location: "remote",
            localDisabled: null,
            remoteDisabled: remote.disabled,
        });
    }

    status.accounts.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return status;
}

function buildRemoteAuthContent(account: LocalAccount) {
    return JSON.stringify(
        {
            type: "codex",
            access_token: account.access_token,
            created_at: new Date().toISOString(),
            ...(account.email ? { email: account.email } : {}),
            ...(isLocalDisabled(account) ? { disabled: true } : {}),
        },
        null,
        2,
    );
}

export async function runSync(direction: "pull" | "push" | "both"): Promise<SyncRunResult> {
    const config = await getCpaConfig();
    const startedAt = new Date().toISOString();

    if (!config.enabled) {
        return {
            ok: false,
            error: "CPA sync is not configured",
            direction,
            uploaded: 0,
            upload_failed: 0,
            downloaded: 0,
            download_failed: 0,
            remote_deleted: 0,
            disabled_aligned: 0,
            disabled_align_failed: 0,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
        };
    }

    const client = new CpaClient(config);
    const result: SyncRunResult = {
        ok: true,
        direction,
        uploaded: 0,
        upload_failed: 0,
        downloaded: 0,
        download_failed: 0,
        remote_deleted: 0,
        disabled_aligned: 0,
        disabled_align_failed: 0,
        started_at: startedAt,
        finished_at: startedAt,
    };

    try {
        const localAccounts = await listAccounts();
        const remoteMap = await loadRemoteAuthFiles(client);

        if (direction === "pull" || direction === "both") {
            const remoteOnlyTokens = Array.from(remoteMap.values())
                .filter((item) => !localAccounts.some((account) => account.access_token === item.accessToken))
                .map((item) => item.accessToken);

            if (remoteOnlyTokens.length > 0) {
                const added = await addAccounts(remoteOnlyTokens);
                result.downloaded += added.added ?? remoteOnlyTokens.length;
                await refreshAccounts(remoteOnlyTokens);
            }

            for (const remote of remoteMap.values()) {
                const local = localAccounts.find((account) => account.access_token === remote.accessToken);
                if (!local) {
                    continue;
                }
                const shouldDisable = remote.disabled;
                const isDisabled = isLocalDisabled(local);
                if (shouldDisable !== isDisabled) {
                    try {
                        await updateAccount(local.access_token, { status: shouldDisable ? "禁用" : "正常" });
                        result.disabled_aligned += 1;
                    } catch {
                        result.disabled_align_failed += 1;
                    }
                }
            }
        }

        if (direction === "push" || direction === "both") {
            for (const account of localAccounts) {
                const remote = remoteMap.get(account.access_token);
                if (!remote) {
                    try {
                        await client.uploadAuthFile(buildAccountName(account.access_token), buildRemoteAuthContent(account));
                        result.uploaded += 1;
                    } catch {
                        result.upload_failed += 1;
                    }
                    continue;
                }

                if (remote.disabled !== isLocalDisabled(account)) {
                    try {
                        await client.patchAuthFileStatus(remote.name, isLocalDisabled(account));
                        result.disabled_aligned += 1;
                    } catch {
                        result.disabled_align_failed += 1;
                    }
                }
            }
        }
    } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : "执行 CPA 同步失败";
    }

    result.finished_at = new Date().toISOString();
    saveSyncRun(result);
    return result;
}
