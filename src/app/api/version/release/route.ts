import { getAppVersion } from "@/server/config";
import { jsonOk } from "@/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELEASES_PAGE_URL = "https://github.com/Hopesy/Eidos/releases";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/Hopesy/Eidos/releases/latest";
const INSTALLER_ASSET_PATTERN = /^Eidos-Setup-.*\.exe$/i;

type ReleaseRouteState = {
  supported: boolean;
  status:
    | "idle"
    | "checking"
    | "up-to-date"
    | "update-available"
    | "downloading"
    | "installer-ready"
    | "error";
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

function normalizeVersion(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/^v+/i, "");
}

function parseVersion(value: string | null | undefined) {
  const normalized = normalizeVersion(value);
  const [mainPart, preRelease = ""] = normalized.split("-", 2);
  const parts = mainPart
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  return { parts, preRelease };
}

function compareVersions(left: string | null | undefined, right: string | null | undefined) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.parts[index] ?? 0;
    const rightPart = b.parts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  if (a.preRelease && !b.preRelease) {
    return -1;
  }
  if (!a.preRelease && b.preRelease) {
    return 1;
  }
  return 0;
}

function selectInstallerAsset(
  assets: Array<{ name?: string; browser_download_url?: string }> | undefined,
) {
  if (!Array.isArray(assets)) {
    return null;
  }

  return (
    assets.find((asset) => INSTALLER_ASSET_PATTERN.test(String(asset?.name || ""))) ??
    assets.find((asset) => /\.exe$/i.test(String(asset?.name || ""))) ??
    null
  );
}

async function fetchLatestRelease() {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Eidos-Web-Release-Checker",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Release 检查失败 (${response.status})`);
  }

  const payload = (await response.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    html_url?: string;
    published_at?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const installerAsset = selectInstallerAsset(payload.assets);
  const version = normalizeVersion(payload.tag_name || payload.name || "");

  if (!version) {
    throw new Error("最新 Release 缺少可识别的版本号");
  }

  return {
    version,
    releaseName: payload.name || payload.tag_name || version,
    releaseNotes: typeof payload.body === "string" ? payload.body.trim() : "",
    publishedAt: payload.published_at || null,
    assetName: installerAsset?.name || null,
    downloadUrl: installerAsset?.browser_download_url || null,
    releasePageUrl: payload.html_url || RELEASES_PAGE_URL,
  };
}

function createBaseState(currentVersion: string): ReleaseRouteState {
  return {
    supported: false,
    status: "idle",
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    publishedAt: null,
    assetName: null,
    downloadUrl: null,
    releasePageUrl: RELEASES_PAGE_URL,
    checkedAt: null,
    message: "浏览器模式可查看 GitHub Release 信息，下载安装请使用桌面版。",
    error: null,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: 0,
    downloadedFilePath: null,
  };
}

export async function GET() {
  const currentVersion = normalizeVersion(await getAppVersion()) || "0.0.0";
  const baseState = createBaseState(currentVersion);

  try {
    const release = await fetchLatestRelease();
    const checkedAt = new Date().toISOString();
    const commonState = {
      latestVersion: release.version,
      releaseName: release.releaseName,
      releaseNotes: release.releaseNotes || null,
      publishedAt: release.publishedAt,
      assetName: release.assetName,
      downloadUrl: release.downloadUrl,
      releasePageUrl: release.releasePageUrl,
      checkedAt,
      error: null,
    };

    if (compareVersions(release.version, currentVersion) > 0) {
      if (!release.downloadUrl) {
        return jsonOk({
          ...baseState,
          ...commonState,
          status: "error",
          message: `发现新版本 v${release.version}，但 Release 中没有可用的 Windows 安装包`,
          error: "missing_installer_asset",
        } satisfies ReleaseRouteState);
      }

      return jsonOk({
        ...baseState,
        ...commonState,
        status: "update-available",
        message: `发现新版本 v${release.version}，浏览器模式请前往 GitHub Release 下载`,
      } satisfies ReleaseRouteState);
    }

    return jsonOk({
      ...baseState,
      ...commonState,
      status: "up-to-date",
      message: `当前已是最新版本 v${currentVersion}`,
    } satisfies ReleaseRouteState);
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败";
    return jsonOk({
      ...baseState,
      status: "error",
      checkedAt: new Date().toISOString(),
      message,
      error: message,
    } satisfies ReleaseRouteState);
  }
}
