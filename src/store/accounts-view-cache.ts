"use client";

import type { Account, AccountQuotaResponse } from "@/lib/api";

type CachedAccountsView = {
  items: Account[];
  quotaMap: Record<string, AccountQuotaResponse>;
};

let cachedAccountsView: CachedAccountsView | null = null;

export function getCachedAccountsView(): CachedAccountsView | null {
  return cachedAccountsView;
}

export function setCachedAccountsView(value: CachedAccountsView | null): void {
  cachedAccountsView = value;
}

export function clearCachedAccountsView(): void {
  cachedAccountsView = null;
}
