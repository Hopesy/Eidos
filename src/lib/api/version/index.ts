import type { DesktopUpdaterState } from "@/lib/desktop-updater";
import { httpRequest } from "@/lib/request";

import type { VersionInfo } from "../types";

export async function fetchVersionInfo() {
  return httpRequest<VersionInfo>("/api/version");
}

export async function fetchLatestReleaseInfo() {
  return httpRequest<DesktopUpdaterState>("/api/version/release");
}
