/**
 * 请求日志 SQLite 存储。
 * 保留最近 500 条结构化记录，重启后仍可在请求记录页查看。
 */

import { randomUUID } from "node:crypto";

import { getDb, withTransaction } from "@/server/db";

export type RequestLogEntry = {
  id: string;
  startedAt: string;
  finishedAt: string;
  endpoint: string;
  operation: string;
  route: string;
  model: string;
  count: number;
  success: boolean;
  error?: string;
  durationMs: number;
  accountEmail?: string;
  accountType?: string;
  failureKind?: string;
  retryAction?: string;
  retryable?: boolean;
  stage?: string;
  upstreamConversationId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
  attemptCount?: number;
  finalStatus?: "success" | "partial" | "failed";
  apiStyle?: string;
  statusCode?: number;
};

const MAX_LOGS = 500;

export function addRequestLog(entry: Omit<RequestLogEntry, "id">): void {
  const record: RequestLogEntry = { id: randomUUID(), ...entry };
  const createdAt = record.finishedAt || new Date().toISOString();

  withTransaction((database) => {
    database.prepare(`
      INSERT INTO request_logs (
        id, data_json, started_at, finished_at, endpoint, operation, route,
        model, count, success, error, duration_ms, account_email, account_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      JSON.stringify(record),
      record.startedAt,
      record.finishedAt,
      record.endpoint,
      record.operation,
      record.route,
      record.model,
      record.count,
      record.success ? 1 : 0,
      record.error ?? null,
      record.durationMs,
      record.accountEmail ?? null,
      record.accountType ?? null,
      createdAt,
    );

    database.prepare(`
      DELETE FROM request_logs
      WHERE id NOT IN (
        SELECT id FROM request_logs ORDER BY created_at DESC LIMIT ?
      )
    `).run(MAX_LOGS);
  });
}

export function getRequestLogs(): RequestLogEntry[] {
  const rows = getDb()
    .prepare("SELECT data_json FROM request_logs ORDER BY created_at DESC LIMIT ?")
    .all(MAX_LOGS) as Array<{ data_json?: string }>;

  return rows
    .map((row) => {
      try {
        return JSON.parse(String(row.data_json || "{}")) as RequestLogEntry;
      } catch {
        return null;
      }
    })
    .filter((item): item is RequestLogEntry => Boolean(item));
}
