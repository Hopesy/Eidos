export type AccountType = "Free" | "Plus" | "Pro" | "Team";
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";

export type AccountRecord = {
  access_token: string;
  type: AccountType;
  status: AccountStatus;
  quota: number;
  email: string | null;
  user_id: string | null;
  limits_progress: Array<Record<string, unknown>>;
  default_model_slug: string | null;
  restore_at: string | null;
  success: number;
  fail: number;
  last_used_at: string | null;
  fp?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PublicAccount = {
  id: string;
  access_token: string;
  type: AccountType;
  status: AccountStatus;
  quota: number;
  email?: string | null;
  user_id?: string | null;
  limits_progress?: Array<Record<string, unknown>>;
  default_model_slug?: string | null;
  restoreAt?: string | null;
  success: number;
  fail: number;
  lastUsedAt: string | null;
};

export type RuntimeConfig = {
  authKey: string;
  host: string;
  port: number;
  accountsFile: string;
  refreshAccountIntervalMinute: number;
  version: string;
};

export type AccountRefreshError = {
  access_token: string;
  error: string;
};
