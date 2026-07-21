import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

const packageRoot = process.cwd();
const sourceRoot = resolve(packageRoot, "src");
const coverage = process.argv.includes("--coverage");
const thresholds = readThresholds(process.argv.slice(2));
const testSources = (await findFiles(sourceRoot))
  .filter((path) => path.endsWith(".test.ts"))
  .sort();

if (testSources.length === 0) {
  throw new Error(`No source tests found below ${sourceRoot}.`);
}

const testOutputs = testSources.map((sourcePath) => {
  const sourceRelativePath = relative(sourceRoot, sourcePath);
  return resolve(packageRoot, "dist", sourceRelativePath.replace(/\.ts$/, ".js"));
});

await Promise.all(testOutputs.map((testOutput) => access(testOutput)));

const args = [];

if (coverage) {
  assertCoverageRuntime();
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-include=dist/**/*.js",
    "--test-coverage-exclude=dist/**/*.test.js",
    "--test-coverage-exclude=dist/**/*test-helpers.js",
    `--test-coverage-lines=${thresholds.lines}`,
    `--test-coverage-branches=${thresholds.branches}`,
    `--test-coverage-functions=${thresholds.functions}`,
  );
}

args.push("--test", ...testOutputs);

const child = spawn(process.execPath, args, {
  cwd: packageRoot,
  stdio: "inherit",
});

child.once("error", (error) => {
  throw error;
});

child.once("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});

async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function readThresholds(args) {
  if (!coverage) {
    return undefined;
  }

  const values = Object.fromEntries(
    args
      .filter((argument) => argument.startsWith("--") && argument.includes("="))
      .map((argument) => argument.slice(2).split("=", 2)),
  );
  const result = {
    lines: Number(values.lines),
    branches: Number(values.branches),
    functions: Number(values.functions),
  };

  for (const [name, value] of Object.entries(result)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Missing or invalid coverage threshold --${name}.`);
    }
  }

  return result;
}

function assertCoverageRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);

  if (major < 22 || (major === 22 && minor < 8)) {
    throw new Error(
      "Coverage requires Node.js >=22.8 for built-in include/exclude filters and thresholds.",
    );
  }
}
