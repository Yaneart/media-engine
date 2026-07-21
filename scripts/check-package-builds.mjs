#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compareFileSets,
  emittedFilesForSource,
  listFiles,
  publicPackages,
  workspaceRoot,
} from "./public-packages.mjs";

const command = process.argv[2];
const staleFixtureFiles = [
  "__deleted-fixture-regression__.d.ts",
  "__deleted-fixture-regression__.js",
  "__deleted-fixture-regression__.js.map",
];

if (command === "seed") {
  for (const packageInfo of publicPackages) {
    const distDirectory = path.join(workspaceRoot, packageInfo.directory, "dist");
    await mkdir(distDirectory, { recursive: true });
    await Promise.all(
      staleFixtureFiles.map((file) =>
        writeFile(path.join(distDirectory, file), "stale build regression fixture\n", "utf8"),
      ),
    );
  }

  console.log(`Seeded stale build fixtures in ${publicPackages.length} package dist directories.`);
} else if (command === "verify") {
  for (const packageInfo of publicPackages) {
    const packageDirectory = path.join(workspaceRoot, packageInfo.directory);
    const sourceFiles = (await listFiles(path.join(packageDirectory, "src"))).filter((file) =>
      file.endsWith(".ts"),
    );
    const expectedOutputs = sourceFiles.flatMap(emittedFilesForSource).sort();
    const actualOutputs = await listFiles(path.join(packageDirectory, "dist"));

    compareFileSets(`${packageInfo.name} source/output`, expectedOutputs, actualOutputs);
    console.log(
      `${packageInfo.name}: ${sourceFiles.length} sources -> ${actualOutputs.length} clean outputs.`,
    );
  }
} else {
  throw new Error("Usage: node scripts/check-package-builds.mjs <seed|verify>");
}
