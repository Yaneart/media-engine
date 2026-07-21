import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const publicPackages = [
  { name: "@media-engine/core", directory: "packages/core" },
  { name: "@media-engine/providers", directory: "packages/providers" },
  { name: "@media-engine/sdk", directory: "packages/sdk" },
];

export async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(workspaceRoot, relativePath), "utf8"));
}

export async function listFiles(directory) {
  const files = [];

  async function visit(currentDirectory, relativeDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(directory, "");
  return files.sort();
}

export function emittedFilesForSource(sourcePath) {
  const stem = sourcePath.slice(0, -3);
  return [`${stem}.d.ts`, `${stem}.js`, `${stem}.js.map`];
}

export function isPackagedSource(sourcePath) {
  return !/\.(?:test|spec)\.ts$/.test(sourcePath) && !/test-helpers\.ts$/.test(sourcePath);
}

export function compareFileSets(label, expectedFiles, actualFiles) {
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);
  const missing = [...expected].filter((file) => !actual.has(file)).sort();
  const unexpected = [...actual].filter((file) => !expected.has(file)).sort();

  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }

  const details = [];
  if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
  if (unexpected.length > 0) details.push(`unexpected: ${unexpected.join(", ")}`);
  throw new Error(`${label} inventory mismatch (${details.join("; ")})`);
}
