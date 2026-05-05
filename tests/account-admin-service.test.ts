import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAccountAdminService } from "../src/server/account/admin-service.ts";
import type { AccountAdminStoreDependencies } from "../src/server/account/admin-service.ts";
import type { AccountRecord } from "../src/server/types.ts";

function cloneAccounts(accounts: AccountRecord[]) {
  return structuredClone(accounts);
}

function createAccount(overrides: Partial<AccountRecord> & { access_token: string }): AccountRecord {
  return {
    access_token: overrides.access_token,
    type: "Free",
    status: "正常",
    quota: 0,
    email: null,
    user_id: null,
    limits_progress: [],
    default_model_slug: null,
    restore_at: null,
    success: 0,
    fail: 0,
    last_used_at: null,
    updated_at: null,
    last_refreshed_at: null,
    ...overrides,
  };
}

function createMemoryStore(initialAccounts: AccountRecord[]) {
  let records = cloneAccounts(initialAccounts);

  const dependencies: AccountAdminStoreDependencies = {
    async readAccounts() {
      return cloneAccounts(records);
    },
    async updateAccounts<T>(updater: (accounts: AccountRecord[]) => Promise<T> | T) {
      const working = cloneAccounts(records);
      const result = await updater(working);
      records = cloneAccounts(working);
      return result;
    },
  };

  return {
    dependencies,
    records() {
      return cloneAccounts(records);
    },
  };
}

function publicId(accessToken: string) {
  return createHash("sha1").update(accessToken).digest("hex").slice(0, 16);
}

describe("account admin service", () => {
  it("lists normalized public accounts and token views", async () => {
    const store = createMemoryStore([
      createAccount({
        access_token: " token-a ",
        type: "personal" as AccountRecord["type"],
        status: "未知" as AccountRecord["status"],
        quota: -5,
        email: " user@example.com ",
        user_id: "",
        restore_at: " 2026-05-01T00:00:00.000Z ",
        last_used_at: " 2026-04-30T10:00:00.000Z ",
        updated_at: "2026-04-30T10:01:00.000Z",
        last_refreshed_at: "2026-04-30T10:02:00.000Z",
      }),
      createAccount({
        access_token: "token-b",
        status: "限流",
        quota: 3,
      }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    assert.deepEqual(await service.listTokens(), ["token-a", "token-b"]);
    assert.deepEqual(await service.listLimitedTokens(), ["token-b"]);
    assert.deepEqual(await service.listAccounts(), [
      {
        id: publicId("token-a"),
        access_token: "token-a",
        type: "Plus",
        status: "正常",
        quota: 0,
        email: "user@example.com",
        user_id: null,
        limits_progress: [],
        default_model_slug: null,
        restoreAt: "2026-05-01T00:00:00.000Z",
        success: 0,
        fail: 0,
        lastUsedAt: "2026-04-30T10:00:00.000Z",
        updatedAt: "2026-04-30T10:01:00.000Z",
        lastRefreshedAt: "2026-04-30T10:02:00.000Z",
      },
      {
        id: publicId("token-b"),
        access_token: "token-b",
        type: "Free",
        status: "限流",
        quota: 3,
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
      },
    ]);
  });

  it("adds only unique new tokens and preserves existing account metadata", async () => {
    const store = createMemoryStore([
      createAccount({
        access_token: "token-existing",
        type: "Pro",
        status: "限流",
        quota: 8,
        success: 2,
      }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    const result = await service.addAccounts([" token-new ", "token-existing", "", "token-new"]);

    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.items.map((item) => item.access_token), ["token-existing", "token-new"]);
    assert.deepEqual(store.records().map((item) => ({
      token: item.access_token,
      type: item.type,
      status: item.status,
      quota: item.quota,
      success: item.success,
    })), [
      {
        token: "token-existing",
        type: "Pro",
        status: "限流",
        quota: 8,
        success: 2,
      },
      {
        token: "token-new",
        type: "Free",
        status: "正常",
        quota: 0,
        success: 0,
      },
    ]);
  });

  it("finds stored accounts by derived public id", async () => {
    const store = createMemoryStore([
      createAccount({
        access_token: "token-a",
        email: "user-a@example.com",
      }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    const account = await service.getAccountById(publicId("token-a"));

    assert.equal(account?.id, publicId("token-a"));
    assert.equal(account?.access_token, "token-a");
    assert.equal(account?.email, "user-a@example.com");
  });

  it("deletes requested tokens and reports removed count", async () => {
    const store = createMemoryStore([
      createAccount({ access_token: "token-a" }),
      createAccount({ access_token: "token-b" }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    const result = await service.deleteAccounts(["token-a", "token-a", "missing", ""]);

    assert.equal(result.removed, 1);
    assert.deepEqual(result.items.map((item) => item.access_token), ["token-b"]);
    assert.deepEqual(store.records().map((item) => item.access_token), ["token-b"]);
  });

  it("updates one account with normalized fields and keeps token identity stable", async () => {
    const store = createMemoryStore([
      createAccount({
        access_token: "token-a",
        type: "Free",
        status: "正常",
        quota: 4,
      }),
      createAccount({
        access_token: "token-b",
        type: "Plus",
        status: "正常",
        quota: 5,
      }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    const updated = await service.updateAccount(" token-a ", {
      access_token: "should-not-replace",
      type: "business" as AccountRecord["type"],
      status: "bad-status" as AccountRecord["status"],
      quota: -20,
      email: "   ",
      fail: -1,
    });

    assert.deepEqual({
      accessToken: updated?.access_token,
      type: updated?.type,
      status: updated?.status,
      quota: updated?.quota,
      email: updated?.email,
      fail: updated?.fail,
    }, {
      accessToken: "token-a",
      type: "Team",
      status: "正常",
      quota: 0,
      email: null,
      fail: 0,
    });
    assert.deepEqual(store.records().map((item) => [item.access_token, item.type, item.quota]), [
      ["token-a", "Team", 0],
      ["token-b", "Plus", 5],
    ]);
  });

  it("marks image success and fail without drifting quota semantics", async () => {
    const store = createMemoryStore([
      createAccount({
        access_token: "token-success",
        status: "正常",
        quota: 1,
        success: 2,
        fail: 1,
      }),
      createAccount({
        access_token: "token-fail",
        status: "正常",
        quota: 3,
        success: 0,
        fail: 4,
      }),
    ]);
    const service = createAccountAdminService(store.dependencies);

    const success = await service.markImageResult("token-success", true);
    const fail = await service.markImageResult("token-fail", false);
    const missing = await service.markImageResult("missing", true);

    assert.equal(success?.success, 3);
    assert.equal(success?.fail, 1);
    assert.equal(success?.quota, 0);
    assert.equal(success?.status, "限流");
    assert.ok(success?.last_used_at);
    assert.equal(Number.isNaN(Date.parse(success?.last_used_at ?? "")), false);

    assert.equal(fail?.success, 0);
    assert.equal(fail?.fail, 5);
    assert.equal(fail?.quota, 3);
    assert.equal(fail?.status, "正常");
    assert.ok(fail?.last_used_at);
    assert.equal(Number.isNaN(Date.parse(fail?.last_used_at ?? "")), false);

    assert.equal(missing, null);
  });
});
