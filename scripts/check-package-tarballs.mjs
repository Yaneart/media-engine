#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  compareFileSets,
  emittedFilesForSource,
  isPackagedSource,
  listFiles,
  publicPackages,
  readJson,
  workspaceRoot,
} from "./public-packages.mjs";

for (const packageInfo of publicPackages) {
  const packageDirectory = path.join(workspaceRoot, packageInfo.directory);
  const manifest = await readJson(`${packageInfo.directory}/package.json`);
  const sourceFiles = (await listFiles(path.join(packageDirectory, "src")))
    .filter((file) => file.endsWith(".ts"))
    .filter(isPackagedSource);
  const expectedFiles = [
    ...sourceFiles.flatMap((file) => emittedFilesForSource(file).map((output) => `dist/${output}`)),
    "LICENSE",
    "README.md",
    "README.ru.md",
    "package.json",
  ].sort();

  const output = execFileSync(
    "pnpm",
    ["--filter", packageInfo.name, "pack", "--dry-run", "--json"],
    { cwd: workspaceRoot, encoding: "utf8" },
  );
  const pack = JSON.parse(output);
  const actualFiles = pack.files.map(({ path: file }) => file).sort();

  if (pack.name !== packageInfo.name || pack.version !== manifest.version) {
    throw new Error(
      `${packageInfo.name} dry pack identity mismatch: ${String(pack.name)}@${String(pack.version)}.`,
    );
  }

  const forbiddenFiles = actualFiles.filter(
    (file) =>
      /\.(?:test|spec)\.(?:d\.ts|js|js\.map)$/.test(file) ||
      /test-helpers\.(?:d\.ts|js|js\.map)$/.test(file) ||
      /^(?:dist\/)?(?:kodik|tmdb)(?:\/|$)/.test(file),
  );
  if (forbiddenFiles.length > 0) {
    throw new Error(
      `${packageInfo.name} dry pack contains forbidden files: ${forbiddenFiles.join(", ")}`,
    );
  }

  compareFileSets(`${packageInfo.name} dry pack`, expectedFiles, actualFiles);
  console.log(`${packageInfo.name}: clean dry pack with ${actualFiles.length} files.`);
}
