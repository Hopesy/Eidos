const RELEASES_PAGE_URL = "https://github.com/Hopesy/Eidos/releases";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/Hopesy/Eidos/releases/latest";
const INSTALLER_ASSET_PATTERN = /^Eidos-Setup-.*\.exe$/i;

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v+/i, "");
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const [mainPart, preRelease = ""] = normalized.split("-", 2);
  const parts = mainPart
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  return { parts, preRelease };
}

function compareVersions(left, right) {
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

function selectInstallerAsset(assets) {
  if (!Array.isArray(assets)) {
    return null;
  }

  return (
    assets.find((asset) => INSTALLER_ASSET_PATTERN.test(String(asset?.name || ""))) ??
    assets.find((asset) => /\.exe$/i.test(String(asset?.name || ""))) ??
    null
  );
}

function parseLatestReleasePayload(payload) {
  const installerAsset = selectInstallerAsset(payload?.assets);
  const version = normalizeVersion(payload?.tag_name || payload?.name || "");

  if (!version) {
    throw new Error("最新 Release 缺少可识别的版本号");
  }

  return {
    version,
    releaseName: payload?.name || payload?.tag_name || version,
    releaseNotes: typeof payload?.body === "string" ? payload.body.trim() : "",
    publishedAt: payload?.published_at || null,
    assetName: installerAsset?.name || null,
    downloadUrl: installerAsset?.browser_download_url || null,
    releasePageUrl: payload?.html_url || RELEASES_PAGE_URL,
  };
}

module.exports = {
  RELEASES_PAGE_URL,
  LATEST_RELEASE_API_URL,
  INSTALLER_ASSET_PATTERN,
  normalizeVersion,
  compareVersions,
  selectInstallerAsset,
  parseLatestReleasePayload,
};
