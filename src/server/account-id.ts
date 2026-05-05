import { createHash } from "node:crypto";

function cleanString(value: unknown) {
  return String(value || "").trim();
}

export function createAccountId(accessToken: unknown) {
  const normalized = cleanString(accessToken);
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

export function resolveAccountId(account: { id?: unknown; access_token?: unknown } | null | undefined) {
  const accessToken = cleanString(account?.access_token);
  return cleanString(account?.id) || (accessToken ? createAccountId(accessToken) : "");
}
