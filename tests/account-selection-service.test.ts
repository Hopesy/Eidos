import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAccountSelector } from "../src/server/account-selection-service.ts";
import type { AccountRecord } from "../src/server/types.ts";

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

describe("account selection service", () => {
  it("prefers accounts that already report local quota before probing zero-quota candidates", async () => {
    const refreshCalls: string[] = [];
    const selector = createAccountSelector({
      async listRecords() {
        return [
          createAccount({ access_token: "token-with-quota", quota: 2 }),
          createAccount({ access_token: "token-zero", quota: 0 }),
        ];
      },
      async refreshAccountState(accessToken: string) {
        refreshCalls.push(accessToken);
        return accessToken === "token-with-quota"
          ? createAccount({ access_token: accessToken, quota: 1, status: "正常" })
          : createAccount({ access_token: accessToken, quota: 5, status: "正常" });
      },
    });

    const selected = await selector.getAvailableAccessToken();

    assert.equal(selected, "token-with-quota");
    assert.deepEqual(refreshCalls, ["token-with-quota"]);
  });

  it("falls back to zero-quota candidates when the positive-quota batch is exhausted", async () => {
    const refreshCalls: string[] = [];
    const selector = createAccountSelector({
      async listRecords() {
        return [
          createAccount({ access_token: "token-a", quota: 3 }),
          createAccount({ access_token: "token-b", quota: 1 }),
          createAccount({ access_token: "token-c", quota: 0 }),
        ];
      },
      async refreshAccountState(accessToken: string) {
        refreshCalls.push(accessToken);
        if (accessToken === "token-c") {
          return createAccount({ access_token: accessToken, quota: 4, status: "正常" });
        }
        return createAccount({ access_token: accessToken, quota: 0, status: "限流" });
      },
    });

    const excludedTokens = new Set<string>();
    const selected = await selector.getAvailableAccessToken(excludedTokens);

    assert.equal(selected, "token-c");
    assert.deepEqual(refreshCalls, ["token-a", "token-b", "token-c"]);
    assert.deepEqual(Array.from(excludedTokens), ["token-a", "token-b"]);
  });

  it("rotates across eligible candidates and honors reset", async () => {
    const selector = createAccountSelector({
      async listRecords() {
        return [
          createAccount({ access_token: "token-a", quota: 1 }),
          createAccount({ access_token: "token-b", quota: 1 }),
        ];
      },
      async refreshAccountState(accessToken: string) {
        return createAccount({ access_token: accessToken, quota: 2, status: "正常" });
      },
    });

    assert.equal(await selector.getAvailableAccessToken(), "token-a");
    assert.equal(await selector.getAvailableAccessToken(), "token-b");

    selector.reset(1);
    assert.equal(await selector.getAvailableAccessToken(), "token-a");
  });

  it("throws a stable error when no candidates survive filtering", async () => {
    const selector = createAccountSelector({
      async listRecords() {
        return [
          createAccount({ access_token: "token-disabled", status: "禁用", quota: 3 }),
        ];
      },
      async refreshAccountState(accessToken: string) {
        return createAccount({ access_token: accessToken, quota: 0, status: "限流" });
      },
    });

    await assert.rejects(
      () => selector.getAvailableAccessToken(new Set(["token-disabled"])),
      /暂无可用账号，请先在账号管理页面添加并启用账号/,
    );
  });
});
