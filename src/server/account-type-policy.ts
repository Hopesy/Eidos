import type { AccountType } from "@/server/types";

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

export function normalizeAccountType(value: unknown): AccountType | null {
  const normalized = cleanToken(value).toLowerCase();
  const mapping: Record<string, AccountType> = {
    free: "Free",
    plus: "Plus",
    team: "Team",
    pro: "Pro",
    personal: "Plus",
    business: "Team",
    enterprise: "Team",
  };
  return mapping[normalized] ?? null;
}
