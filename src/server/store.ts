import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getRuntimeConfig } from "@/server/config";
import type { AccountRecord } from "@/server/types";

class AsyncLock {
  private current = Promise.resolve();

  async run<T>(task: () => Promise<T>) {
    const previous = this.current;
    let release!: () => void;
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const lock = new AsyncLock();

async function readStoreFile() {
  const { accountsFile } = await getRuntimeConfig();
  try {
    const text = await readFile(accountsFile, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [] as AccountRecord[];
    }
    return parsed.filter((item) => item && typeof item === "object") as AccountRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [] as AccountRecord[];
    }
    if (error instanceof SyntaxError) {
      return [] as AccountRecord[];
    }
    throw error;
  }
}

async function writeStoreFile(accounts: AccountRecord[]) {
  const { accountsFile } = await getRuntimeConfig();
  await mkdir((await import("node:path")).dirname(accountsFile), { recursive: true });
  await writeFile(accountsFile, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
}

export async function readAccounts() {
  return lock.run(() => readStoreFile());
}

export async function writeAccounts(accounts: AccountRecord[]) {
  return lock.run(async () => {
    await writeStoreFile(accounts);
  });
}

export async function updateAccounts<T>(updater: (accounts: AccountRecord[]) => Promise<T> | T) {
  return lock.run(async () => {
    const accounts = await readStoreFile();
    const result = await updater(accounts);
    await writeStoreFile(accounts);
    return result;
  });
}
