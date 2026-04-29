export type DesktopShellApi = {
  openDataDir: () => Promise<{ opened: boolean; path: string }>;
};

export function getDesktopShellApi(): DesktopShellApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.eidosShell ?? null;
}
