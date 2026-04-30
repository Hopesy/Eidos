import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveExistingPath(candidate) {
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  for (const extension of [".ts", ".tsx", ".js", ".mjs", ".cjs"]) {
    const filePath = `${candidate}${extension}`;
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return filePath;
    }
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const extension of [".ts", ".tsx", ".js", ".mjs", ".cjs"]) {
      const indexPath = path.join(candidate, `index${extension}`);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveExistingPath(path.join(projectRoot, "src", specifier.slice(2)));
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelativeImport = specifier.startsWith("./") || specifier.startsWith("../");
    if (!isRelativeImport || !context.parentURL?.startsWith("file:")) {
      throw error;
    }

    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = resolveExistingPath(path.resolve(parentDir, specifier));
    if (!resolved) {
      throw error;
    }

    return nextResolve(pathToFileURL(resolved).href, context);
  }
}
