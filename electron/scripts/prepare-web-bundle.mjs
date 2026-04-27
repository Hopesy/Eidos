import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(electronRoot, "..");
const sourceStandaloneDir = path.join(repoRoot, ".next", "standalone");
const sourceStaticDir = path.join(repoRoot, ".next", "static");
const sourcePublicDir = path.join(repoRoot, "public");
const targetAppDir = path.join(electronRoot, "app");
const targetStandaloneDir = path.join(targetAppDir, "standalone");
const targetStaticDir = path.join(targetStandaloneDir, ".next", "static");
const targetPublicDir = path.join(targetStandaloneDir, "public");
const pruneAfterCopy = [
  ".git",
  ".github",
  ".playwright-mcp",
  "assets",
  "data",
  "docs",
  "electron",
  "logs",
  "scripts",
  "src",
];
const sharpPackages = [
  "node_modules/.pnpm/@img+colour@1.1.0",
  "node_modules/.pnpm/@img+sharp-win32-x64@0.34.5",
  "node_modules/.pnpm/@img+sharp-win32-x64@0.35.1",
  "node_modules/.pnpm/@img+sharp-libvips-win32-x64@1.1.0",
  "node_modules/.pnpm/sharp@0.34.5",
  "node_modules/.pnpm/sharp@0.35.1",
  "node_modules/.pnpm/detect-libc@2.1.2",
  "node_modules/.pnpm/semver@7.7.4",
  "node_modules/sharp",
  "node_modules/@img",
];

async function fileExists(target) {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(target) {
  try {
    const targetStat = await stat(target);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
}

async function readVersion() {
  const versionFile = path.join(repoRoot, "VERSION");
  if (await fileExists(versionFile)) {
    return (await readFile(versionFile, "utf8")).trim() || "0.0.0";
  }
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  return String(packageJson.version || "0.0.0");
}

async function main() {
  if (!(await directoryExists(sourceStandaloneDir))) {
    throw new Error("缺少 .next/standalone，请先在仓库根目录执行 pnpm build");
  }
  if (!(await directoryExists(sourceStaticDir))) {
    throw new Error("缺少 .next/static，请先在仓库根目录执行 pnpm build");
  }

  await rm(targetAppDir, { recursive: true, force: true });
  await mkdir(path.join(targetStandaloneDir, ".next"), { recursive: true });

  await cp(sourceStandaloneDir, targetStandaloneDir, { recursive: true, dereference: true });
  await cp(sourceStaticDir, targetStaticDir, { recursive: true, dereference: true });
  if (await directoryExists(sourcePublicDir)) {
    await cp(sourcePublicDir, targetPublicDir, { recursive: true, dereference: true });
  }

  for (const relativePath of pruneAfterCopy) {
    await rm(path.join(targetStandaloneDir, relativePath), { recursive: true, force: true });
  }
  for (const relativePath of sharpPackages) {
    await rm(path.join(targetStandaloneDir, relativePath), { recursive: true, force: true });
  }

  await writeFile(path.join(targetStandaloneDir, "VERSION"), `${await readVersion()}\n`, "utf8");
  console.log(`Prepared desktop web bundle at ${targetStandaloneDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
