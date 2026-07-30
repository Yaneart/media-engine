#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = await capture("node", ["scripts/browser-media-fixture.mjs"]);
const compatible = await runHarness(fixture, "fixture.webm", false);
const unusual = await runHarness(fixture, "fixture.unusual", true);
const nonMedia = await runHarness(undefined, "fixture.bin", true);

assert.equal(compatible.nativeBrowser?.outcome, "pass");
assert.equal(compatible.nativeBrowser?.played, true);
assert.equal(compatible.nativeBrowser?.seeked, true);
assert.equal(compatible.nativeBrowser?.hasAudio, true);
assert.equal(compatible.cleanup, "verified");
assert.equal(unusual.extensionIndependent, true);
assert.equal(unusual.cleanup, "verified");
assert.equal(nonMedia.nativeBrowser?.outcome, "fail");
assert.equal(nonMedia.cleanup, "verified");

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    firefox: (await captureText("firefox", ["--version"])).trim(),
    compatible: compatible.nativeBrowser,
    unusualExtension: unusual.nativeBrowser,
    healthyNonMedia: nonMedia.nativeBrowser,
    cleanup: "verified",
  })}\n`,
);

async function runHarness(bytes, name, allowBrowserRejection) {
  const argumentsList = [
    "compose",
    "exec",
    "-T",
    "api",
    "node",
    "scripts/original-torrent-range-smoke.mjs",
    "--browser",
    `--name=${name}`,
    ...(bytes === undefined ? [] : ["--stdin-media"]),
    ...(allowBrowserRejection ? ["--allow-browser-rejection"] : []),
  ];
  const child = spawn("docker", argumentsList, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (bytes === undefined) child.stdin.end();
  else child.stdin.end(bytes);

  let stdout = "";
  let stderr = "";
  let pending = "";
  let browserRun;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdout += text;
    pending += text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const value = parseJson(line);
      if (value?.status === "READY" && Number.isSafeInteger(value.port)) {
        browserRun ??= runFirefox(value.port);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const exitCode = await waitForExit(child, 90_000);
  await browserRun;
  assert.equal(exitCode, 0, stderr || stdout);
  const result = stdout
    .trim()
    .split("\n")
    .map(parseJson)
    .findLast((value) => value?.status === "PASS");
  assert.notEqual(result, undefined, stdout);
  return result;
}

async function runFirefox(port) {
  const containerIp = (
    await captureText("docker", [
      "inspect",
      "--format",
      '{{with index .NetworkSettings.Networks "media-engine-dev_default"}}{{.IPAddress}}{{end}}',
      "media-engine-dev-api-1",
    ])
  ).trim();
  assert.match(containerIp, /^\d{1,3}(?:\.\d{1,3}){3}$/u);
  const profile = await mkdtemp(join(tmpdir(), "media-engine-firefox-acceptance-"));
  try {
    const screenshot = join(profile, "acceptance.png");
    const exitCode = await waitForExit(
      spawn(
        "firefox",
        [
          "--headless",
          "--profile",
          profile,
          "--screenshot",
          screenshot,
          `http://${containerIp}:${port}/test`,
        ],
        { stdio: "ignore" },
      ),
      60_000,
    );
    assert.equal(exitCode, 0);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

function capture(command, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function captureText(command, argumentsList) {
  return (await capture(command, argumentsList)).toString("utf8");
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Process ${child.spawnfile} exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
