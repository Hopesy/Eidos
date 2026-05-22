import type { ResponsesReasoningEffort } from "@/lib/api";
import { isResponsesReasoningEffort } from "@/shared/app-config";

export type ResponsesReasoningEffortParseResult =
  | {
    ok: true;
    effort?: ResponsesReasoningEffort;
  }
  | {
    ok: false;
  };

export function parseResponsesReasoningEffort(value: unknown): ResponsesReasoningEffortParseResult {
  const effort = String(value || "").trim().toLowerCase();
  if (!effort) {
    return { ok: true };
  }
  if (!isResponsesReasoningEffort(effort) || effort === "default") {
    return { ok: false };
  }
  return { ok: true, effort };
}

export function extractResponsesReasoningEffortFromBody(body: Record<string, unknown>): ResponsesReasoningEffortParseResult {
  if (!body.reasoning || typeof body.reasoning !== "object") {
    return { ok: true };
  }
  return parseResponsesReasoningEffort((body.reasoning as Record<string, unknown>).effort);
}
