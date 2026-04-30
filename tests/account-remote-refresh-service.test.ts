import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  createAccountRemoteRefreshService,
  type AccountRemoteRefreshDependencies,
} from "../src/server/account-remote-refresh-service.ts";
import type { AccountRecord, PublicAccount } from "../src/server/types.ts";

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

function createJwtPlanToken(planType: string) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_plan_type: planType,
      },
    }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

function toPublicAccount(record: AccountRecord): PublicAccount {
  return {
    id: createHash("sha1").update(record.access_token).digest("hex").slice(0, 16),
    access_token: record.access_token,
    type: record.type,
    status: record.status,
    quota: record.quota,
    email: record.email,
    user_id: record.user_id,
    limits_progress: record.limits_progress,
    default_model_slug: record.default_model_slug,
    restoreAt: record.restore_at,
    success: record.success,
    fail: record.fail,
    lastUsedAt: record.last_used_at,
    updatedAt: record.updated_at,
    lastRefreshedAt: record.last_refreshed_at,
  };
}

function createMemoryDependencies(
  initialAccounts: AccountRecord[],
  overrides?: Partial<AccountRemoteRefreshDependencies>,
) {
  const records = new Map(initialAccounts.map((account) => [account.access_token, structuredClone(account)]));

  const dependencies: AccountRemoteRefreshDependencies = {
    async getAccount(accessToken: string) {
      return structuredClone(records.get(accessToken) ?? null);
    },
    async updateAccount(accessToken: string, updates: Partial<AccountRecord>) {
      const current = records.get(accessToken);
      if (!current) {
        return null;
      }
      const next = {
        ...current,
        ...updates,
        access_token: current.access_token,
      } satisfies AccountRecord;
      records.set(accessToken, structuredClone(next));
      return structuredClone(next);
    },
    async listAccounts() {
      return Array.from(records.values()).map((record) => toPublicAccount(structuredClone(record)));
    },
    async fetchRemoteAccountInfo() {
      throw new Error("fetchRemoteAccountInfo test double is required");
    },
    now() {
      return "2026-04-30T12:00:00.000Z";
    },
    ...overrides,
  };

  return {
    dependencies,
    record(accessToken: string) {
      return structuredClone(records.get(accessToken) ?? null);
    },
  };
}

describe("account remote refresh service", () => {
  it("maps remote payloads into normalized local account fields", async () => {
    const accessToken = createJwtPlanToken("pro");
    const store = createMemoryDependencies(
      [createAccount({ access_token: accessToken, type: "Free", status: "异常" })],
      {
        async fetchRemoteAccountInfo() {
          return {
            mePayload: {
              email: " user@example.com ",
              id: " user-1 ",
            },
            initPayload: {
              default_model_slug: " gpt-4.1 ",
              limits_progress: [
                {
                  feature_name: "image_gen",
                  remaining: 7,
                  reset_after: " 2026-05-01T00:00:00.000Z ",
                },
              ],
              workspace: {
                plan_type: "enterprise",
              },
            },
          };
        },
      },
    );
    const service = createAccountRemoteRefreshService(store.dependencies);

    const remoteInfo = await service.fetchAccountRemoteInfo(accessToken);

    assert.deepEqual(remoteInfo, {
      email: "user@example.com",
      user_id: "user-1",
      type: "Pro",
      quota: 7,
      limits_progress: [
        {
          feature_name: "image_gen",
          remaining: 7,
          reset_after: " 2026-05-01T00:00:00.000Z ",
        },
      ],
      default_model_slug: "gpt-4.1",
      restore_at: "2026-05-01T00:00:00.000Z",
      status: "正常",
    });
  });

  it("marks 401 refreshes as abnormal with zero quota", async () => {
    const store = createMemoryDependencies(
      [createAccount({ access_token: "token-401", quota: 5, status: "正常" })],
      {
        async fetchRemoteAccountInfo() {
          throw new Error("/backend-api/me failed: HTTP 401");
        },
      },
    );
    const service = createAccountRemoteRefreshService(store.dependencies);

    const refreshed = await service.refreshAccountState("token-401");

    assert.equal(refreshed?.status, "异常");
    assert.equal(refreshed?.quota, 0);
    assert.equal(store.record("token-401")?.status, "异常");
    assert.equal(store.record("token-401")?.quota, 0);
  });

  it("dedupes bulk refreshes, stamps refreshed time, and reports 401 separately", async () => {
    const calls: string[] = [];
    const store = createMemoryDependencies(
      [
        createAccount({ access_token: "token-a", quota: 1, status: "正常" }),
        createAccount({ access_token: "token-b", quota: 3, status: "正常" }),
      ],
      {
        async fetchRemoteAccountInfo(accessToken: string) {
          calls.push(accessToken);
          if (accessToken === "token-b") {
            throw new Error("/backend-api/me failed: HTTP 401");
          }
          return {
            mePayload: {
              email: "a@example.com",
              id: "user-a",
            },
            initPayload: {
              default_model_slug: "gpt-4.1-mini",
              limits_progress: [
                {
                  feature_name: "image_gen",
                  remaining: 9,
                  reset_after: "2026-05-02T00:00:00.000Z",
                },
              ],
            },
          };
        },
      },
    );
    const service = createAccountRemoteRefreshService(store.dependencies);

    const result = await service.refreshAccounts([" token-a ", "token-b", "token-a", ""], {
      markRefreshedAt: true,
    });

    assert.equal(result.refreshed, 1);
    assert.deepEqual(calls, ["token-a", "token-b"]);
    assert.deepEqual(result.errors, [{ access_token: "token-b", error: "检测到封号" }]);
    assert.equal(store.record("token-a")?.quota, 9);
    assert.equal(store.record("token-a")?.status, "正常");
    assert.equal(store.record("token-a")?.last_refreshed_at, "2026-04-30T12:00:00.000Z");
    assert.equal(store.record("token-b")?.status, "异常");
    assert.equal(store.record("token-b")?.quota, 0);
    assert.equal(result.items.find((item) => item.access_token === "token-a")?.quota, 9);
    assert.equal(result.items.find((item) => item.access_token === "token-b")?.status, "异常");
    assert.equal(result.items.find((item) => item.access_token === "token-b")?.quota, 0);
  });

  it("returns current items immediately when refresh input is empty", async () => {
    const store = createMemoryDependencies(
      [createAccount({ access_token: "token-a", quota: 2, status: "正常" })],
      {
        async fetchRemoteAccountInfo() {
          throw new Error("should not be called");
        },
      },
    );
    const service = createAccountRemoteRefreshService(store.dependencies);

    const result = await service.refreshAccounts(["", "   "]);

    assert.equal(result.refreshed, 0);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.items.map((item) => item.access_token), ["token-a"]);
  });
});
