import { createAccountId } from "@/server/account-id";
import { getDb, withTransaction } from "@/server/db";
import type { AccountRecord } from "@/server/types";

class AsyncLock {
  private current = Promise.resolve();

  async run<T>(task: () => Promise<T> | T) {
    const previous = this.current;
    let release!: () => void;
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const lock = new AsyncLock();

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function cleanNullableString(value: unknown) {
  const normalized = cleanString(value);
  return normalized || null;
}

function parseAccount(row: Record<string, unknown>): AccountRecord | null {
  try {
    const parsed = JSON.parse(String(row.data_json || "{}")) as AccountRecord;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      ...parsed,
      updated_at: cleanNullableString(row.updated_at),
    };
  } catch {
    return null;
  }
}

function bindAccount(account: AccountRecord) {
  const accessToken = cleanString(account.access_token);
  return [
    accessToken,
    createAccountId(accessToken),
    cleanNullableString(account.email),
    cleanNullableString(account.user_id),
    cleanString(account.type) || "Free",
    cleanString(account.status) || "正常",
    Math.max(0, Number(account.quota ?? 0) || 0),
    JSON.stringify(Array.isArray(account.limits_progress) ? account.limits_progress : []),
    cleanNullableString(account.default_model_slug),
    cleanNullableString(account.restore_at),
    Math.max(0, Number(account.success ?? 0) || 0),
    Math.max(0, Number(account.fail ?? 0) || 0),
    cleanNullableString(account.last_used_at),
    account.fp && typeof account.fp === "object" ? JSON.stringify(account.fp) : null,
    JSON.stringify(account),
  ];
}

function upsertAccountStatement() {
  return getDb().prepare(`
    INSERT INTO accounts (
      access_token, id, email, user_id, type, status, quota,
      limits_progress_json, default_model_slug, restore_at, success, fail,
      last_used_at, fp_json, data_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM accounts WHERE access_token = ?), ?), ?)
    ON CONFLICT(access_token) DO UPDATE SET
      id = excluded.id,
      email = excluded.email,
      user_id = excluded.user_id,
      type = excluded.type,
      status = excluded.status,
      quota = excluded.quota,
      limits_progress_json = excluded.limits_progress_json,
      default_model_slug = excluded.default_model_slug,
      restore_at = excluded.restore_at,
      success = excluded.success,
      fail = excluded.fail,
      last_used_at = excluded.last_used_at,
      fp_json = excluded.fp_json,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);
}

async function readAccountsUnlocked() {
  const rows = getDb()
    .prepare("SELECT data_json, updated_at FROM accounts ORDER BY created_at ASC, access_token ASC")
    .all();
  return rows.map(parseAccount).filter((item): item is AccountRecord => Boolean(item));
}

async function writeAccountsUnlocked(accounts: AccountRecord[]) {
  withTransaction((database) => {
    database.prepare("DELETE FROM accounts").run();
    const insert = upsertAccountStatement();
    const now = new Date().toISOString();
    for (const account of accounts) {
      const accessToken = cleanString(account.access_token);
      if (!accessToken) continue;
      insert.run(...bindAccount(account), accessToken, now, now);
    }
  });
}

export async function readAccounts() {
  return lock.run(() => readAccountsUnlocked());
}

export async function writeAccounts(accounts: AccountRecord[]) {
  return lock.run(() => writeAccountsUnlocked(accounts));
}

export async function updateAccounts<T>(updater: (accounts: AccountRecord[]) => Promise<T> | T) {
  return lock.run(async () => {
    const accounts = await readAccountsUnlocked();
    const result = await updater(accounts);
    await writeAccountsUnlocked(accounts);
    return result;
  });
}
