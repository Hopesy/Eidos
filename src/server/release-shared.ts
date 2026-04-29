import releaseSharedImport from "../../electron/release-shared.cjs";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type ReleasePayload = {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
};

type ReleaseParseResult = {
  version: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string | null;
  assetName: string | null;
  downloadUrl: string | null;
  releasePageUrl: string;
};

type ReleaseSharedModule = {
  RELEASES_PAGE_URL: string;
  LATEST_RELEASE_API_URL: string;
  normalizeVersion(value: string | null | undefined): string;
  compareVersions(left: string | null | undefined, right: string | null | undefined): number;
  selectInstallerAsset(assets: ReleaseAsset[] | undefined): ReleaseAsset | null;
  parseLatestReleasePayload(payload: ReleasePayload): ReleaseParseResult;
};

const releaseShared = releaseSharedImport as ReleaseSharedModule;

export const {
  RELEASES_PAGE_URL,
  LATEST_RELEASE_API_URL,
  normalizeVersion,
  compareVersions,
  selectInstallerAsset,
  parseLatestReleasePayload,
} = releaseShared;

export type { ReleasePayload, ReleaseParseResult };
