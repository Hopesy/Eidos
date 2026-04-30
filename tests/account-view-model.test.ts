import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAccountsSummary,
  buildImportSummary,
  filterAndSortAccounts,
  formatRelativeTime,
  formatTableTime,
  getAbnormalTokens,
  getSelectedTokens,
  maskToken,
  normalizeAccounts,
  normalizeSyncStatus,
  pruneSelectedIds,
} from "../src/features/accounts/account-view-model.ts";
import type { Account, SyncStatusResponse } from "../src/lib/api.ts";

function createAccount(overrides: Partial<Account> & { id: string; access_token: string }): Account {
  return {
    id: overrides.id,
    access_token: overrides.access_token,
    type: "Free",
    status: "正常",
    quota: 0,
    email: null,
    user_id: null,
    limits_progress: [],
    default_model_slug: null,
    restoreAt: null,
    success: 0,
    fail: 0,
    lastUsedAt: null,
    updatedAt: null,
    lastRefreshedAt: null,
    ...overrides,
  };
}

describe("account view model", () => {
  it("normalizes, filters, and sorts accounts for the page", () => {
    const accounts = normalizeAccounts([
      createAccount({
        id: "1",
        access_token: "token-1",
        email: "alpha@example.com",
        type: "Free",
        status: "异常",
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      createAccount({
        id: "2",
        access_token: "token-2",
        email: "beta@example.com",
        type: "Plus",
        status: "正常",
        updatedAt: "2026-04-30T09:00:00.000Z",
      }),
      createAccount({
        id: "3",
        access_token: "token-3",
        email: "beta-2@example.com",
        type: "mystery" as Account["type"],
        status: "正常",
        updatedAt: "2026-04-30T11:00:00.000Z",
      }),
      createAccount({
        id: "4",
        access_token: "token-4",
        email: "gamma@example.com",
        type: "Team",
        status: "限流",
        updatedAt: "2026-04-30T12:00:00.000Z",
      }),
    ]);

    assert.equal(accounts[2]?.type, "Free");

    const filtered = filterAndSortAccounts(accounts, {
      query: "beta",
      typeFilter: "all",
      statusFilter: "all",
    });
    assert.deepEqual(
      filtered.map((item) => item.id),
      ["3", "2"],
    );

    const typed = filterAndSortAccounts(accounts, {
      query: "",
      typeFilter: "Team",
      statusFilter: "限流",
    });
    assert.deepEqual(
      typed.map((item) => item.id),
      ["4"],
    );
  });

  it("builds summary, token selections, and selected id pruning", () => {
    const accounts = [
      createAccount({ id: "1", access_token: "token-1", status: "正常", quota: 5 }),
      createAccount({ id: "2", access_token: "token-2", status: "限流", quota: 0 }),
      createAccount({ id: "3", access_token: "token-3", status: "异常", quota: 2 }),
      createAccount({ id: "4", access_token: "token-4", status: "禁用", quota: 1 }),
    ];

    assert.deepEqual(buildAccountsSummary(accounts), {
      total: 4,
      active: 1,
      limited: 1,
      abnormal: 1,
      disabled: 1,
      quota: "8",
    });
    assert.deepEqual(getSelectedTokens(accounts, ["1", "3"]), ["token-1", "token-3"]);
    assert.deepEqual(getAbnormalTokens(accounts), ["token-3"]);
    assert.deepEqual(pruneSelectedIds(["1", "missing", "4"], accounts), ["1", "4"]);
  });

  it("formats import, token, time, and sync status view data", () => {
    assert.equal(
      buildImportSummary({
        items: [],
        imported: 2,
        refreshed: 1,
        duplicates: [{ name: "a.json", reason: "duplicate" }],
        failed: [{ name: "b.json", error: "bad token" }],
      }),
      "导入 2 个，刷新 1 个，重复 1 个，失败 1 个",
    );
    assert.equal(maskToken("short-token"), "short-token");
    assert.equal(maskToken("12345678901234567890123456"), "1234567890123456...90123456");
    assert.equal(formatRelativeTime("2026-05-02T03:00:00.000Z", Date.parse("2026-05-01T00:00:00.000Z")), "剩余 1d 3h");
    assert.equal(formatRelativeTime("2026-04-30T23:00:00.000Z", Date.parse("2026-05-01T00:00:00.000Z")), "已到恢复时间");
    assert.equal(formatTableTime("2026-04-30T08:05:00"), "2026-04-30 08:05");

    const normalized = normalizeSyncStatus({
      configured: true,
      local: 2,
      remote: 3,
      disabledMismatch: 1,
      accounts: [{ name: "a.json", status: "pending_upload", location: "local" }],
      summary: {
        synced: 1,
        pending_upload: 2,
        remote_only: 3,
        remote_deleted: 4,
      },
      lastRun: null,
    } satisfies SyncStatusResponse);

    assert.deepEqual(normalized, {
      configured: true,
      local: 2,
      remote: 3,
      accounts: [{ name: "a.json", status: "pending_upload", location: "local" }],
      disabledMismatch: 1,
      lastRun: null,
      summary: {
        synced: 1,
        pending_upload: 2,
        remote_only: 3,
        remote_deleted: 4,
      },
    });
    assert.deepEqual(normalizeSyncStatus(null), {
      configured: false,
      local: 0,
      remote: 0,
      accounts: [],
      disabledMismatch: 0,
      lastRun: null,
      summary: {
        synced: 0,
        pending_upload: 0,
        remote_only: 0,
        remote_deleted: 0,
      },
    });
  });
});
