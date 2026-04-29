import type { DesktopUpdaterApi } from "@/lib/desktop-updater";
import type { DesktopShellApi } from "@/lib/desktop-shell";

declare global {
  interface Window {
    eidosUpdater?: DesktopUpdaterApi;
    eidosShell?: DesktopShellApi;
  }
}

export {};
