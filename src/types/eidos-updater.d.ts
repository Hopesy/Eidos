import type { DesktopUpdaterApi } from "@/lib/desktop-updater";

declare global {
  interface Window {
    eidosUpdater?: DesktopUpdaterApi;
  }
}

export {};
