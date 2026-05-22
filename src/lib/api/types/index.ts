export type AccountType = "Free" | "Plus" | "Pro" | "Team";
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";
export type ImageModel = "gpt-image-1" | "gpt-image-2";
export type ImageGenerationSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "256x256"
  | "512x512"
  | "1792x1024"
  | "1024x1792"
  | "1920x1088"
  | "2048x2048"
  | "3072x2048"
  | "2048x3072"
  | "2560x1440"
  | "2880x2880"
  | "3520x2336"
  | "2336x3520"
  | "3840x2160"
  | "1088x1920"
  | "1440x2560"
  | "2160x3840";
export type ImageGenerationQuality = "auto" | "low" | "medium" | "high";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageApiStyle = "v1" | "responses";
export type ResponsesReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SyncStatus =
  | "synced"
  | "pending_upload"
  | "remote_only"
  | "remote_deleted";

export type ImageConversationContinuation = {
  conversation_id: string;
  parent_message_id: string;
  source_account_id: string;
};

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
  updatedAt?: string | null;
  lastRefreshedAt?: string | null;
  fileName?: string;
  provider?: string;
  disabled?: boolean;
  note?: string | null;
  priority?: number;
  refresh_error?: string | null;
  refresh_error_reason?: string | null;
  syncStatus?: SyncStatus | null;
  syncOrigin?: string | null;
  lastSyncedAt?: string | null;
  remoteDisabled?: boolean | null;
};

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

export type AccountImportResponse = {
  items: Account[];
  imported?: number;
  imported_files?: number;
  refreshed?: number;
  errors?: Array<{ access_token: string; error: string; reason?: string }>;
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
  refresh_error_reason?: string;
};

export type ImageResponseItem = {
  url?: string;
  image_id?: string;
  file_path?: string;
  b64_json?: string;
  text?: string;
  revised_prompt?: string;
  file_id?: string;
  gen_id?: string;
  response_id?: string;
  image_generation_call_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
  upstreamParentMessageId?: string;
  failureKind?: string;
  retryAction?: string;
  retryable?: boolean;
  stage?: string;
  upstreamConversationId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
  statusCode?: number;
  lastPollStatus?: number;
  pollStatusCounts?: Record<string, number>;
  pollAttempts?: number;
  retryAfterMs?: number;
  upstreamBodyPreview?: string;
};

export type GalleryImageItem = {
  favoriteId: string;
  imageId: string;
  imageLocalId: string;
  imageUrl: string;
  createdAt: string;
  conversationId: string;
  turnId: string;
  title: string;
  mode: "generate" | "edit" | "upscale";
  prompt: string;
  revisedPrompt?: string;
  model: ImageModel;
  imageRatio?: "auto" | "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
  imageSize?: ImageGenerationSize;
  imageQuality?: ImageGenerationQuality;
  imageFormat?: ImageOutputFormat;
  count: number;
  durationMs?: number;
  sourceAccountId?: string;
  note?: string | null;
};

export type InpaintSourceReference = {
  original_file_id?: string;
  original_gen_id?: string;
  previous_response_id?: string;
  image_generation_call_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
};

export type RequestLogItem = {
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
  upstreamParentMessageId?: string;
  upstreamResponseId?: string;
  imageGenerationCallId?: string;
  sourceAccountId?: string;
  fileIds?: string[];
  attemptCount?: number;
  finalStatus?: "success" | "partial" | "failed";
  apiStyle?: string;
  statusCode?: number;
  lastPollStatus?: number;
  pollStatusCounts?: Record<string, number>;
  pollAttempts?: number;
  retryAfterMs?: number;
  upstreamBodyPreview?: string;
};

export type RecoverableImageTaskItem = {
  id: string;
  localConversationId?: string | null;
  localTurnId?: string | null;
  mode: "generate" | "edit" | "upscale";
  status: "pending" | "succeeded" | "failed";
  failureKind?: string | null;
  retryAction?: string | null;
  retryable?: boolean | null;
  stage?: string | null;
  upstreamConversationId?: string | null;
  upstreamResponseId?: string | null;
  imageGenerationCallId?: string | null;
  sourceAccountId?: string | null;
  fileIds?: string[];
  statusCode?: number | null;
  lastPollStatus?: number | null;
  pollStatusCounts?: Record<string, number> | null;
  pollAttempts?: number | null;
  retryAfterMs?: number | null;
  upstreamBodyPreview?: string | null;
  revisedPrompt?: string | null;
  model?: string | null;
  prompt?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VersionInfo = {
  version: string;
  commit?: string;
  buildTime?: string;
};
