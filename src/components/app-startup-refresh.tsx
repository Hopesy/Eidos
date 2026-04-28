"use client";

import { useEffect } from "react";

import { refreshAccounts } from "@/lib/api";
import { APP_CREDENTIALS_REFRESHED_EVENT } from "@/lib/app-startup-refresh";

export function AppStartupRefresh() {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const result = await refreshAccounts([]);
        if (cancelled) {
          return;
        }
        window.dispatchEvent(
          new CustomEvent(APP_CREDENTIALS_REFRESHED_EVENT, {
            detail: {
              refreshed: result.refreshed ?? 0,
              errors: result.errors ?? [],
              at: new Date().toISOString(),
            },
          }),
        );
      } catch (error) {
        if (!cancelled) {
          console.warn("[Eidos] startup account refresh failed", error);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
