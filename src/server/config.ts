import { mkdir } from "node:fs/promises";
import path from "node:path";

import packageJson from "../../package.json";
import type { RuntimeConfig } from "@/server/types";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const DEFAULT_REFRESH_INTERVAL_MINUTE = 5;

function getDataDir() {
  const configuredDataDir = process.env.EIDOS_DATA_DIR?.trim();
  if (configuredDataDir) {
    return path.resolve(/*turbopackIgnore: true*/ configuredDataDir);
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

async function readVersion() {
  const envVersion = String(process.env.NEXT_PUBLIC_APP_VERSION || "").trim();
  if (envVersion) {
    return envVersion;
  }

  return packageJson.version || "0.0.0";
}

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = (async () => {
      const dataDir = getDataDir();
      await mkdir(/*turbopackIgnore: true*/ dataDir, { recursive: true });
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
  return process.cwd();
}

export async function getAppVersion() {
  return readVersion();
}
