#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listFiles, publicPackages, readJson, workspaceRoot } from "./public-packages.mjs";
import { createSmokeUserAgent, MEDIA_ENGINE_SMOKE_VERSION } from "./smoke-user-agent.mjs";

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const manifests = new Map();

for (const packageInfo of publicPackages) {
  const manifest = await readJson(`${packageInfo.directory}/package.json`);
  if (manifest.name !== packageInfo.name) {
    throw new Error(
      `${packageInfo.directory}/package.json has unexpected name ${String(manifest.name)}.`,
    );
  }
  if (!semverPattern.test(manifest.version)) {
    throw new Error(`${packageInfo.name} has invalid version ${String(manifest.version)}.`);
  }
  manifests.set(packageInfo.name, manifest);
}

const versions = new Set([...manifests.values()].map((manifest) => manifest.version));
if (versions.size !== 1) {
  throw new Error(
    `Public package versions differ: ${[...manifests.entries()]
      .map(([name, manifest]) => `${name}=${manifest.version}`)
      .join(", ")}.`,
  );
}
const releaseVersion = versions.values().next().value;

for (const [packageName, manifest] of manifests) {
  for (const dependencyGroup of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dependencyName, specifier] of Object.entries(manifest[dependencyGroup] ?? {})) {
      if (manifests.has(dependencyName) && specifier !== "workspace:*") {
        throw new Error(
          `${packageName} ${dependencyGroup}.${dependencyName} must use workspace:* so pnpm packs the matching ${releaseVersion} dependency, found ${specifier}.`,
        );
      }
    }
  }
}

const coreSource = await readWorkspaceFile("packages/core/src/index.ts");
assertSourceVersion(
  coreSource,
  "MEDIA_ENGINE_CORE_VERSION",
  releaseVersion,
  "packages/core/src/index.ts",
);

const providerSource = await readWorkspaceFile("packages/providers/src/package-version.ts");
assertSourceVersion(
  providerSource,
  "MEDIA_ENGINE_PROVIDERS_VERSION",
  releaseVersion,
  "packages/providers/src/package-version.ts",
);

const coreRuntime = await importRuntime("packages/core/dist/index.js");
if (coreRuntime.MEDIA_ENGINE_CORE_VERSION !== releaseVersion) {
  throw new Error(
    `Built MEDIA_ENGINE_CORE_VERSION is ${String(coreRuntime.MEDIA_ENGINE_CORE_VERSION)}, expected ${releaseVersion}.`,
  );
}
const providerRuntime = await importRuntime("packages/providers/dist/package-version.js");
if (providerRuntime.MEDIA_ENGINE_PROVIDERS_VERSION !== releaseVersion) {
  throw new Error(
    `Built MEDIA_ENGINE_PROVIDERS_VERSION is ${String(providerRuntime.MEDIA_ENGINE_PROVIDERS_VERSION)}, expected ${releaseVersion}.`,
  );
}
const expectedDefaultUserAgent = `MediaEngine/${releaseVersion} (https://github.com/Yaneart/media-engine)`;
if (providerRuntime.MEDIA_ENGINE_DEFAULT_USER_AGENT !== expectedDefaultUserAgent) {
  throw new Error(
    `Built default User-Agent is ${String(providerRuntime.MEDIA_ENGINE_DEFAULT_USER_AGENT)}, expected ${expectedDefaultUserAgent}.`,
  );
}
if (
  MEDIA_ENGINE_SMOKE_VERSION !== releaseVersion ||
  !createSmokeUserAgent("ReleaseCheck").includes(`/${releaseVersion} `)
) {
  throw new Error(`Smoke User-Agent version does not match public release ${releaseVersion}.`);
}

const openApiSource = await readWorkspaceFile("apps/api/src/openapi.ts");
const apiContractVersion = extractSourceVersion(
  openApiSource,
  "MEDIA_ENGINE_API_CONTRACT_VERSION",
  "apps/api/src/openapi.ts",
);
if (!semverPattern.test(apiContractVersion)) {
  throw new Error(`API contract version ${apiContractVersion} is not semantic.`);
}

const changelog = await readWorkspaceFile("CHANGELOG.md");
const latestRelease = changelog.match(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m)?.[1];
if (latestRelease !== releaseVersion) {
  throw new Error(
    `Latest CHANGELOG release heading is ${String(latestRelease)}, expected ${releaseVersion}.`,
  );
}

const productionVersionSources = [
  ["packages/providers/src", await readSourceTree("packages/providers/src")],
  ["apps/api/src", await readSourceTree("apps/api/src")],
  ["scripts", await readSmokeScripts()],
];
for (const [directory, content] of productionVersionSources) {
  if (/MediaEngine[A-Za-z]*\/\d+\.\d+(?:\.\d+)?\b/.test(content)) {
    throw new Error(`${directory} contains a hard-coded MediaEngine User-Agent version.`);
  }
}

console.log(
  `Release consistency passed: packages/runtime/User-Agent ${releaseVersion}, API contract ${apiContractVersion}, changelog ${latestRelease}.`,
);

async function readWorkspaceFile(relativePath) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

async function importRuntime(relativePath) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  try {
    return await import(pathToFileURL(absolutePath).href);
  } catch (error) {
    throw new Error(`Cannot load built runtime ${relativePath}; run the package build first.`, {
      cause: error,
    });
  }
}

function assertSourceVersion(source, constantName, expected, relativePath) {
  const actual = extractSourceVersion(source, constantName, relativePath);
  if (actual !== expected) {
    throw new Error(`${relativePath} ${constantName} is ${actual}, expected ${expected}.`);
  }
}

function extractSourceVersion(source, constantName, relativePath) {
  const match = source.match(new RegExp(`\\b${constantName}\\s*=\\s*[\"']([^\"']+)[\"']`));
  if (!match) {
    throw new Error(`Cannot find ${constantName} string literal in ${relativePath}.`);
  }
  return match[1];
}

async function readSourceTree(relativeDirectory) {
  const directory = path.join(workspaceRoot, relativeDirectory);
  const files = (await listFiles(directory)).filter(
    (file) => file.endsWith(".ts") && !/\.(?:test|spec)\.ts$/.test(file),
  );
  return (
    await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))
  ).join("\n");
}

async function readSmokeScripts() {
  const directory = path.join(workspaceRoot, "scripts");
  const files = (await listFiles(directory)).filter((file) => /(?:smoke|audit)\.mjs$/.test(file));
  return (
    await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))
  ).join("\n");
}
