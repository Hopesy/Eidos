import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeConfig } from "@/server/types";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const DEFAULT_REFRESH_INTERVAL_MINUTE = 5;

const repoRoot = path.resolve(/* turbopackIgnore: true */ process.cwd());
const dataDir = path.resolve(
  process.env.EIDOS_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"),
);
const versionFile = path.join(repoRoot, "VERSION");

async function readVersion() {
  try {
    const value = (await readFile(versionFile, "utf8")).trim();
    return value || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = (async () => {
      await mkdir(dataDir, { recursive: true });
      const refreshAccountIntervalMinute = Number(process.env.REFRESH_ACCOUNT_INTERVAL_MINUTE || DEFAULT_REFRESH_INTERVAL_MINUTE);

      return {
        host: String(process.env.HOST || DEFAULT_HOST),
        port: Number(process.env.PORT || DEFAULT_PORT),
        accountsFile: path.join(dataDir, "accounts.json"),
        refreshAccountIntervalMinute:
          Number.isFinite(refreshAccountIntervalMinute) && refreshAccountIntervalMinute > 0
            ? refreshAccountIntervalMinute
            : DEFAULT_REFRESH_INTERVAL_MINUTE,
        version: await readVersion(),
      };
    })();
  }

  return runtimeConfigPromise;
}

export function getRepoRoot() {
  return repoRoot;
}

export async function getAppVersion() {
  return readVersion();
}
