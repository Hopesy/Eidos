import { httpRequest } from "@/lib/request";

// ─── 基础枚举 / 联合类型 ──────────────────────────────────────────────────────

export type AccountType = "Free" | "Plus" | "Pro" | "Team";
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";
export type ImageModel = "gpt-image-1" | "gpt-image-2";
export type ImageProviderMode = "studio" | "cpa" | "mix";
export type SyncStatus =
  | "synced"
  | "pending_upload"
  | "remote_only"
  | "remote_deleted";

// ─── Account 类型 ─────────────────────────────────────────────────────────────

export type Account = {
  id: string;
  access_token: string;
  type: AccountType;
  status: AccountStatus;
  quota: number;
  email?: string | null;
  user_id?: string | null;
  limits_progress?: Array<{
    feature_name?: string;
    remaining?: number;
    reset_after?: string;
  }>;
  default_model_slug?: string | null;
  restoreAt?: string | null;
  success: number;
  fail: number;
  lastUsedAt: string | null;
  // 新增字段
  fileName?: string;
  provider?: string;
  disabled?: boolean;
  note?: string | null;
  priority?: number;
  syncStatus?: SyncStatus | null;
  syncOrigin?: string | null;
  lastSyncedAt?: string | null;
  remoteDisabled?: boolean | null;
};

// ─── Sync 相关类型 ────────────────────────────────────────────────────────────

export type SyncAccount = {
  name: string;
  status: SyncStatus;
  location: "local" | "remote" | "both";
  localDisabled?: boolean | null;
  remoteDisabled?: boolean | null;
};

export type SyncRunResult = {
  ok: boolean;
  error?: string;
  direction?: string;
  uploaded: number;
  upload_failed: number;
  downloaded: number;
  download_failed: number;
  remote_deleted: number;
  disabled_aligned: number;
  disabled_align_failed: number;
  started_at: string;
  finished_at: string;
};

export type SyncStatusResponse = {
  configured: boolean;
  local: number;
  remote: number;
  summary: Record<SyncStatus, number>;
  accounts: SyncAccount[];
  disabledMismatch: number;
  lastRun?: SyncRunResult | null;
};

// ─── Account Import / Quota 响应类型 ─────────────────────────────────────────

export type AccountImportResponse = {
  items: Account[];
  imported?: number;
  imported_files?: number;
  refreshed?: number;
  errors?: Array<{ access_token: string; error: string }>;
  duplicates?: Array<{ name: string; reason: string }>;
  failed?: Array<{ name: string; error: string }>;
};

export type AccountQuotaResponse = {
  id: string;
  email?: string | null;
  status: AccountStatus;
  type: AccountType;
  quota: number;
  image_gen_remaining?: number | null;
  image_gen_reset_after?: string | null;
  refresh_requested: boolean;
  refreshed: boolean;
  refresh_error?: string;
};

// ─── 图像相关类型 ─────────────────────────────────────────────────────────────

export type ImageResponseItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
  file_id?: string;
  gen_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

export type InpaintSourceReference = {
  original_file_id: string;
  original_gen_id: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id: string;
};

// ─── 请求日志类型 ─────────────────────────────────────────────────────────────

export type RequestLogItem = {
  id: string;
  startedAt: string;
  finishedAt: string;
  endpoint: string;
  operation: string;
  imageMode: ImageProviderMode | string;
  direction: "official" | "cpa" | string;
  route: string;
  accountType?: string;
  accountEmail?: string;
  accountFile?: string;
  requestedModel?: string;
  upstreamModel?: string;
  preferred: boolean;
  success: boolean;
  error?: string;
};

// ─── 版本信息类型 ─────────────────────────────────────────────────────────────

export type VersionInfo = {
  version: string;
  commit?: string;
  buildTime?: string;
};

// ─── 配置 Payload 类型 ───────────────────────────────────────────────────────

export type ConfigPayload = {
  app?: {
    authKey?: string;
    [key: string]: unknown;
  };
  server?: {
    port?: number;
    host?: string;
    [key: string]: unknown;
  };
  chatgpt?: {
    baseUrl?: string;
    timeout?: number;
    [key: string]: unknown;
  };
  accounts?: {
    defaultQuota?: number;
    autoRefresh?: boolean;
    refreshInterval?: number;
    [key: string]: unknown;
  };
  storage?: {
    type?: string;
    path?: string;
    [key: string]: unknown;
  };
  sync?: {
    enabled?: boolean;
    provider?: string;
    interval?: number;
    direction?: "pull" | "push" | "both";
    [key: string]: unknown;
  };
  proxy?: {
    enabled?: boolean;
    url?: string;
    [key: string]: unknown;
  };
  cpa?: {
    enabled?: boolean;
    baseUrl?: string;
    [key: string]: unknown;
  };
  log?: {
    level?: string;
    maxItems?: number;
    [key: string]: unknown;
  };
  paths?: {
    data?: string;
    logs?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// ─── 内部响应类型（非 export） ────────────────────────────────────────────────

type AccountListResponse = {
  items: Account[];
};

type AccountMutationResponse = {
  items: Account[];
  added?: number;
  skipped?: number;
  removed?: number;
  refreshed?: number;
  errors?: Array<{ access_token: string; error: string }>;
};

type AccountRefreshResponse = {
  items: Account[];
  refreshed: number;
  errors: Array<{ access_token: string; error: string }>;
};

type AccountUpdateResponse = {
  item: Account;
  items: Account[];
};

// ─── 认证 ─────────────────────────────────────────────────────────────────────

export async function login(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  return httpRequest<{ ok: boolean }>("/auth/login", {
    method: "POST",
    body: {},
    headers: {
      Authorization: `Bearer ${normalizedAuthKey}`,
    },
    redirectOnUnauthorized: false,
  });
}

// ─── Account CRUD ─────────────────────────────────────────────────────────────

export async function fetchAccounts() {
  return httpRequest<AccountListResponse>("/api/accounts");
}

export async function createAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "POST",
    body: { tokens },
  });
}

export async function deleteAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "DELETE",
    body: { tokens },
  });
}

export async function refreshAccounts(accessTokens: string[]) {
  return httpRequest<AccountRefreshResponse>("/api/accounts/refresh", {
    method: "POST",
    body: { access_tokens: accessTokens },
  });
}

export async function updateAccount(
  accessToken: string,
  updates: {
    type?: AccountType;
    status?: AccountStatus;
    quota?: number;
    disabled?: boolean;
    note?: string | null;
    priority?: number;
  },
) {
  return httpRequest<AccountUpdateResponse>("/api/accounts/update", {
    method: "POST",
    body: {
      access_token: accessToken,
      ...updates,
    },
  });
}

// ─── Account 文件导入 ─────────────────────────────────────────────────────────

export async function importAccountFiles(files: File[]) {
  const formData = new FormData();
  files.forEach((f) => formData.append("file", f));
  return httpRequest<AccountImportResponse>("/api/accounts/import", {
    method: "POST",
    body: formData,
  });
}

// ─── Account Quota ────────────────────────────────────────────────────────────

export async function fetchAccountQuota(
  accountId: string,
  options: { refresh?: boolean } = {},
) {
  const { refresh } = options;
  const query = refresh === false ? "?refresh=false" : "";
  return httpRequest<AccountQuotaResponse>(
    `/api/accounts/${encodeURIComponent(accountId)}/quota${query}`,
  );
}

// ─── 同步相关 ─────────────────────────────────────────────────────────────────

export async function fetchSyncStatus() {
  return httpRequest<SyncStatusResponse>("/api/sync/status");
}

export async function runSync(direction: "pull" | "push") {
  return httpRequest<SyncRunResult>("/api/sync/run", {
    method: "POST",
    body: { direction },
  });
}

// ─── 配置 ─────────────────────────────────────────────────────────────────────

export async function fetchConfig() {
  return httpRequest<ConfigPayload>("/api/config");
}

export async function fetchDefaultConfig() {
  return httpRequest<ConfigPayload>("/api/config/defaults");
}

export async function updateConfig(config: ConfigPayload) {
  return httpRequest<ConfigPayload>("/api/config", {
    method: "PUT",
    body: config,
  });
}

// ─── 请求日志 ─────────────────────────────────────────────────────────────────

export async function fetchRequestLogs() {
  return httpRequest<{ items: RequestLogItem[] }>("/api/requests");
}

// ─── 版本信息 ─────────────────────────────────────────────────────────────────

export async function fetchVersionInfo() {
  return httpRequest<VersionInfo>("/version", {
    redirectOnUnauthorized: false,
  });
}

// ─── 图像生成 ─────────────────────────────────────────────────────────────────

export async function generateImage(
  prompt: string,
  model: ImageModel = "gpt-image-1",
  count = 1,
) {
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/generations",
    {
      method: "POST",
      body: {
        prompt,
        model,
        n: count,
        response_format: "b64_json",
      },
    },
  );
}

// ─── 图像编辑（Inpaint / Edit） ───────────────────────────────────────────────

export async function editImage(params: {
  prompt: string;
  images: File[];
  mask?: File | null;
  sourceReference?: InpaintSourceReference | null;
  model?: ImageModel;
}) {
  const { prompt, images, mask, sourceReference, model = "gpt-image-1" } =
    params;
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("model", model);
  formData.append("response_format", "b64_json");
  images.forEach((img) => formData.append("image", img));
  if (mask) {
    formData.append("mask", mask);
  }
  if (sourceReference) {
    formData.append("original_file_id", sourceReference.original_file_id);
    formData.append("original_gen_id", sourceReference.original_gen_id);
    if (sourceReference.conversation_id) {
      formData.append("conversation_id", sourceReference.conversation_id);
    }
    if (sourceReference.parent_message_id) {
      formData.append(
        "parent_message_id",
        sourceReference.parent_message_id,
      );
    }
    formData.append("source_account_id", sourceReference.source_account_id);
  }
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
    },
  );
}

// ─── 图像放大（Upscale） ──────────────────────────────────────────────────────

export async function upscaleImage(params: {
  image: File;
  prompt?: string;
  scale?: number;
  model?: ImageModel;
}) {
  const { image, prompt, scale, model = "gpt-image-1" } = params;
  const formData = new FormData();
  formData.append("image", image);
  formData.append("model", model);
  formData.append("response_format", "b64_json");
  if (prompt !== undefined) {
    formData.append("prompt", prompt);
  }
  if (scale !== undefined) {
    formData.append("scale", String(scale));
  }
  return httpRequest<{ created: number; data: ImageResponseItem[] }>(
    "/v1/images/upscale",
    {
      method: "POST",
      body: formData,
    },
  );
}
