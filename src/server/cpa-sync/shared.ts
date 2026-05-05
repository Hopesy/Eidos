import type { SyncRunResult, SyncStatusResponse } from "@/lib/api";
import { createAccountId } from "@/server/account-id";

export type SavedCpaConfigShape = {
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

export type RemoteAuthFileInfo = {
  name: string;
  type?: string;
  provider?: string;
  email?: string;
  disabled?: boolean;
  note?: string;
  priority?: number;
  auth_index?: string;
};

export type RemoteAuthPayload = {
  name: string;
  accessToken: string;
  email: string | null;
  disabled: boolean;
  raw: Record<string, unknown>;
  meta: RemoteAuthFileInfo;
};

export type CpaConfig = {
  enabled: boolean;
  baseUrl: string;
  managementKey: string;
  providerType: string;
};

export type CpaLocalAccount = {
  access_token: string;
  status: string;
  email?: string | null;
};

export function normalizeProvider(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeToken(value: unknown) {
  return String(value || "").trim();
}

export function buildAccountName(accessToken: string) {
  return `${createAccountId(accessToken)}.json`;
}

export function isLocalDisabled(account: CpaLocalAccount) {
  return account.status === "禁用";
}

export function buildRemoteAuthContent(account: CpaLocalAccount) {
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

export function createEmptySyncStatus(
  configured: boolean,
  lastRun: SyncRunResult | null,
): SyncStatusResponse {
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

export function createUnconfiguredSyncResult(
  direction: "pull" | "push" | "both",
  startedAt: string,
): SyncRunResult {
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

export function createInitialSyncResult(
  direction: "pull" | "push" | "both",
  startedAt: string,
): SyncRunResult {
  return {
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
}
