export type DesktopUpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "downloading"
  | "installer-ready"
  | "error";

export type DesktopUpdaterState = {
  supported: boolean;
  status: DesktopUpdaterStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  assetName: string | null;
  downloadUrl: string | null;
  releasePageUrl: string;
  checkedAt: string | null;
  message: string;
  error: string | null;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number;
  downloadedFilePath: string | null;
};

export type DesktopUpdaterApi = {
  getState: () => Promise<DesktopUpdaterState>;
  checkForUpdates: () => Promise<DesktopUpdaterState>;
  downloadAndInstall: () => Promise<DesktopUpdaterState>;
  onStateChange: (callback: (state: DesktopUpdaterState) => void) => () => void;
};

export function getDesktopUpdaterApi(): DesktopUpdaterApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.eidosUpdater ?? null;
}

export function formatDesktopVersion(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .replace(/^v+/i, "");
  return normalized ? `v${normalized}` : "—";
}
