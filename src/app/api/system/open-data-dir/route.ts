import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDataDir } from "@/server/db";
import { jsonError, jsonOk } from "@/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function openDirectory(targetDir: string) {
  await mkdir(/*turbopackIgnore: true*/ targetDir, { recursive: true });

  if (process.platform === "win32") {
    const child = spawn("explorer.exe", [targetDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [targetDir], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const child = spawn("xdg-open", [targetDir], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function POST() {
  try {
    const dataDir = path.resolve(/*turbopackIgnore: true*/ getDataDir());
    await openDirectory(dataDir);
    return jsonOk({
      opened: true,
      path: dataDir,
    });
  } catch (error) {
    return jsonError(error);
  }
}
