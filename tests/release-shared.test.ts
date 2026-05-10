import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareVersions,
  normalizeVersion,
  parseLatestReleasePayload,
  selectInstallerAsset,
} from "../src/server/release-shared.ts";

describe("release shared policy", () => {
  it("normalizes and compares semantic versions", () => {
    assert.equal(normalizeVersion(" v1.2.3 "), "1.2.3");
    assert.equal(compareVersions("1.2.10", "1.2.2"), 1);
    assert.equal(compareVersions("1.2.0", "1.2"), 0);
    assert.equal(compareVersions("1.2.0-beta", "1.2.0"), -1);
  });

  it("prefers the Eidos NSIS installer asset", () => {
    const asset = selectInstallerAsset([
      { name: "notes.txt", browser_download_url: "notes" },
      { name: "random.exe", browser_download_url: "random" },
      { name: "Eidos-Setup-0.1.10.exe", browser_download_url: "installer" },
    ]);

    assert.equal(asset?.name, "Eidos-Setup-0.1.10.exe");
  });

  it("falls back to any exe asset when the preferred installer is missing", () => {
    const asset = selectInstallerAsset([
      { name: "notes.txt", browser_download_url: "notes" },
      { name: "fallback.exe", browser_download_url: "fallback" },
    ]);

    assert.equal(asset?.browser_download_url, "fallback");
  });

  it("parses latest release payload and installer metadata", () => {
    const parsed = parseLatestReleasePayload({
      tag_name: "v0.1.10",
      name: "Eidos 0.1.10",
      body: "\nRelease notes\n",
      html_url: "https://example.test/release",
      published_at: "2026-04-30T00:00:00Z",
      assets: [
        { name: "Eidos-Setup-0.1.10.exe", browser_download_url: "https://example.test/download" },
      ],
    });

    assert.equal(parsed.version, "0.1.10");
    assert.equal(parsed.releaseName, "Eidos 0.1.10");
    assert.equal(parsed.releaseNotes, "Release notes");
    assert.equal(parsed.assetName, "Eidos-Setup-0.1.10.exe");
    assert.equal(parsed.downloadUrl, "https://example.test/download");
  });

  it("requires a recognizable release version", () => {
    assert.throws(() => parseLatestReleasePayload({ assets: [] }), /缺少可识别的版本号/);
  });
});
