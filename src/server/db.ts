import { createHash } from "node:crypto";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

type Database = InstanceType<typeof DatabaseSync>;

let db: Database | null = null;
let migratedJson = false;

export function getDataDir() {
  return path.resolve(
    process.env.EIDOS_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"),
  );
}

export function getDatabasePath() {
  return path.join(getDataDir(), "eidos.db");
}

function nowIso() {
  return new Date().toISOString();
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function initializeSchema(database: Database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS accounts (
      access_token TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      email TEXT,
      user_id TEXT,
      type TEXT NOT NULL DEFAULT 'Free',
      status TEXT NOT NULL DEFAULT '正常',
      quota INTEGER NOT NULL DEFAULT 0,
      limits_progress_json TEXT NOT NULL DEFAULT '[]',
      default_model_slug TEXT,
      restore_at TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      fail INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      fp_json TEXT,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
    CREATE INDEX IF NOT EXISTS idx_accounts_updated_at ON accounts(updated_at DESC);

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      operation TEXT NOT NULL,
      route TEXT NOT NULL,
      model TEXT NOT NULL,
      count INTEGER NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      duration_ms INTEGER NOT NULL,
      account_email TEXT,
      account_type TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_logs_success ON request_logs(success);
    CREATE INDEX IF NOT EXISTS idx_request_logs_operation ON request_logs(operation);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      direction TEXT,
      ok INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON sync_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS image_files (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      public_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_image_files_created_at ON image_files(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_image_files_sha256 ON image_files(sha256);
    CREATE INDEX IF NOT EXISTS idx_image_files_role ON image_files(role);

    CREATE TABLE IF NOT EXISTS image_conversations (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_image_conversations_created_at ON image_conversations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_image_conversations_status ON image_conversations(status);
  `);
}

function backupLegacyAccountsFile(accountsFile: string) {
  const backupDir = path.join(getDataDir(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, `accounts-json-migrated-${stamp}.json`);
  if (!existsSync(backupFile)) {
    copyFileSync(accountsFile, backupFile);
  }
}

function migrateAccountsJsonIfNeeded(database: Database) {
  if (migratedJson) return;
  migratedJson = true;

  const countRow = database.prepare("SELECT COUNT(*) AS count FROM accounts").get();
  const existingCount = Number(countRow?.count ?? 0);
  if (existingCount > 0) return;

  const accountsFile = path.join(getDataDir(), "accounts.json");
  if (!existsSync(accountsFile)) return;

  const parsed = safeParseJson<unknown>(readFileSync(accountsFile, "utf8"), []);
  if (!Array.isArray(parsed) || parsed.length === 0) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const insert = database.prepare(`
      INSERT OR REPLACE INTO accounts (
        access_token, id, email, user_id, type, status, quota,
        limits_progress_json, default_model_slug, restore_at, success, fail,
        last_used_at, fp_json, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ts = nowIso();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const account = item as Record<string, unknown>;
      const accessToken = String(account.access_token || "").trim();
      if (!accessToken) continue;
      const id = createAccountId(accessToken);
      insert.run(
        accessToken,
        id,
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
        ts,
        ts,
      );
    }
    database.exec("COMMIT");
    backupLegacyAccountsFile(accountsFile);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function createAccountId(accessToken: string) {
  return createHash("sha1").update(accessToken).digest("hex").slice(0, 16);
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function cleanNullableString(value: unknown) {
  const normalized = cleanString(value);
  return normalized || null;
}

export function getDb() {
  if (!db) {
    mkdirSync(getDataDir(), { recursive: true });
    db = new DatabaseSync(getDatabasePath());
    initializeSchema(db);
    migrateAccountsJsonIfNeeded(db);
  }
  return db;
}

export function withTransaction<T>(task: (database: Database) => T): T {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = task(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  return safeParseJson<T>(readFileSync(filePath, "utf8"), fallback);
}



