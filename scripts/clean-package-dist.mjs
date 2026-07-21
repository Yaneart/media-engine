#!/usr/bin/env node

import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const packageDirectory = path.resolve(process.cwd());
const manifestPath = path.join(packageDirectory, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedPackages = new Set([
  "@media-engine/core",
  "@media-engine/providers",
  "@media-engine/sdk",
]);

if (!allowedPackages.has(manifest.name)) {
  throw new Error(`Refusing to clean dist for unexpected package ${String(manifest.name)}.`);
}

const distDirectory = path.join(packageDirectory, "dist");
if (path.dirname(distDirectory) !== packageDirectory || path.basename(distDirectory) !== "dist") {
  throw new Error(`Refusing to clean unsafe path ${distDirectory}.`);
}

await rm(distDirectory, { recursive: true, force: true });
