import {
  ImageGenerationError,
} from "@/server/providers/openai-client";
import { resolveAccountId } from "@/server/account-id";
import type { AccountRecord } from "@/server/types";
import type { AccountPoolSourceReference, UpstreamConversationContext } from "./image-runner-types";

export function cleanToken(value: unknown) {
  return String(value || "").trim();
}

export function normalizeUpstreamContext(input: UpstreamConversationContext | null | undefined): UpstreamConversationContext | null {
  const conversationId = cleanToken(input?.conversationId);
  const parentMessageId = cleanToken(input?.parentMessageId);
  const sourceAccountId = cleanToken(input?.sourceAccountId);
  if (!conversationId || !parentMessageId || !sourceAccountId) {
    return null;
  }
  return {
    conversationId,
    parentMessageId,
    sourceAccountId,
  };
}

export function normalizeSourceReferenceContext(
  sourceReference: AccountPoolSourceReference | null | undefined,
): UpstreamConversationContext | null {
  return normalizeUpstreamContext({
    conversationId: sourceReference?.conversationId,
    parentMessageId: sourceReference?.parentMessageId,
    sourceAccountId: sourceReference?.sourceAccountId,
  });
}

export function getResultUpstreamContext(
  items: Array<Record<string, unknown>>,
  sourceAccountId: string,
): UpstreamConversationContext | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const context = normalizeUpstreamContext({
      conversationId: cleanToken(item?.conversation_id),
      parentMessageId: cleanToken(item?.parent_message_id),
      sourceAccountId: cleanToken(item?.source_account_id) || sourceAccountId,
    });
    if (context) {
      return context;
    }
  }
  return null;
}

export async function getPreferredContinuationAccount(
  getAccountById: (accountId: string) => Promise<AccountRecord | null>,
  context: UpstreamConversationContext | null,
  attempted: Set<string>,
) {
  if (!context?.sourceAccountId) {
    return null;
  }
  const account = await getAccountById(context.sourceAccountId);
  if (!account?.access_token || attempted.has(account.access_token)) {
    return null;
  }
  return account;
}

export function getContinuationForAccount(
  context: UpstreamConversationContext | null,
  account: AccountRecord | null,
) {
  const accountId = resolveAccountId(account);
  if (!context || !accountId || accountId !== context.sourceAccountId) {
    return undefined;
  }
  return {
    conversationId: context.conversationId,
    parentMessageId: context.parentMessageId,
  };
}

export function isRetryableImageError(error: unknown) {
  if (error instanceof ImageGenerationError) {
    if (error.kind === "poll_rate_limited") {
      return false;
    }
    return error.retryable && (error.retryAction === "resubmit" || error.retryAction === "switch_account");
  }
  const normalized = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("content policy") ||
    normalized.includes("safety") ||
    normalized.includes("policy") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid_image") ||
    normalized.includes("bad request") ||
    normalized.includes("400") ||
    normalized.includes("401") ||
    normalized.includes("403")
  ) {
    return false;
  }
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network error") ||
    normalized.includes("request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("terminated") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("und_err") ||
    normalized.includes("socket") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("service unavailable")
  );
}
