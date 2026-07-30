#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_FIXTURE_BYTES = 16 * 1024 * 1024;
let barrier;
let resolveFixture;
let rejectFixture;
const fixture = new Promise((resolve, reject) => {
  resolveFixture = resolve;
  rejectFixture = reject;
});
const server = createServer((request, response) => {
  if (request.url === "/") {
    const body = fixtureHtml();
    response.writeHead(200, {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
    return;
  }
  if (request.url === "/barrier") {
    barrier = response;
    response.writeHead(200, { "content-type": "image/svg+xml" });
    return;
  }
  if (request.url === "/fixture" && request.method === "POST") {
    void readBody(request).then(
      (bytes) => {
        resolveFixture(bytes);
        barrier?.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      },
      (error) => {
        rejectFixture(error);
        barrier?.end();
      },
    );
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404, { "content-length": "0" }).end();
});

const address = await listen(server);
const profile = await mkdtemp(join(tmpdir(), "media-engine-firefox-fixture-"));
const browser = spawn(
  "firefox",
  ["--headless", "--profile", profile, "--screenshot", `http://127.0.0.1:${address.port}/`],
  { stdio: ["ignore", "ignore", "inherit"] },
);

try {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Firefox did not create the browser media fixture in time.")),
      45_000,
    );
    timer.unref();
  });
  const bytes = await Promise.race([fixture, timeout]);
  if (bytes.length < 1) throw new Error("Firefox created an empty browser media fixture.");
  await writeStdout(bytes);
} finally {
  barrier?.end();
  browser.kill("SIGTERM");
  await close(server);
  await rm(profile, { recursive: true, force: true });
}

function fixtureHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>Media Engine deterministic browser fixture</title>
<canvas id="frame" width="320" height="180"></canvas>
<script>
const canvas = document.querySelector("#frame");
const context = canvas.getContext("2d");
const videoStream = canvas.captureStream(20);
const audioContext = new AudioContext();
const oscillator = audioContext.createOscillator();
const gain = audioContext.createGain();
const audioTarget = audioContext.createMediaStreamDestination();
oscillator.frequency.value = 440;
gain.gain.value = 0.15;
oscillator.connect(gain).connect(audioTarget);
oscillator.start();
void audioContext.resume();
const stream = new MediaStream([
  ...videoStream.getVideoTracks(),
  ...audioTarget.stream.getAudioTracks(),
]);
const preferred = "video/webm;codecs=vp8,opus";
const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : "video/webm";
const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 400000 });
const chunks = [];
recorder.addEventListener("dataavailable", (event) => {
  if (event.data.size > 0) chunks.push(event.data);
});
recorder.addEventListener("stop", async () => {
  oscillator.stop();
  for (const track of stream.getTracks()) track.stop();
  await fetch("/fixture", {
    method: "POST",
    headers: { "content-type": mimeType },
    body: new Blob(chunks, { type: mimeType }),
  });
});
const startedAt = performance.now();
function draw(now) {
  const elapsed = now - startedAt;
  context.fillStyle = "#102040";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#62d2a2";
  context.fillRect((elapsed / 8) % canvas.width, 45, 48, 90);
  context.fillStyle = "white";
  context.font = "24px sans-serif";
  context.fillText("Media Engine", 70, 95);
  if (elapsed < 3000) requestAnimationFrame(draw);
  else recorder.stop();
}
recorder.start(100);
requestAnimationFrame(draw);
</script>
<img src="/barrier" alt="">`;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_FIXTURE_BYTES) {
      throw new Error("Firefox browser media fixture exceeded its byte bound.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function listen(value) {
  return new Promise((resolve, reject) => {
    value.once("error", reject);
    value.listen(0, "127.0.0.1", () => {
      value.off("error", reject);
      const address = value.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a browser fixture TCP address."));
        return;
      }
      resolve(address);
    });
  });
}

function close(value) {
  if (!value.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    value.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function writeStdout(bytes) {
  return new Promise((resolve, reject) => {
    process.stdout.write(bytes, (error) =>
      error === undefined || error === null ? resolve() : reject(error),
    );
  });
}
