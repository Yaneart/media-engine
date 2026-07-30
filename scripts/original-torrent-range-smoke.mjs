#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const require = createRequire(import.meta.url);
const {
  readOriginalTorrentRuntimeConfig,
  TorrServerAdapter,
} = require("../apps/api/dist/src/original-torrent-runtime/index.js");
const {
  OriginalTorrentStreamGateway,
} = require("../apps/api/dist/src/original-torrent-stream/stream-gateway.js");

const config = readOriginalTorrentRuntimeConfig(process.env);

if (config === undefined) {
  throw new Error("MEDIA_ENGINE_TORRSERVER_URL is required for the original-range smoke.");
}

const stdinMedia = process.argv.includes("--stdin-media");
const browserMode = process.argv.includes("--browser");
const allowBrowserRejection = process.argv.includes("--allow-browser-rejection");
const singleFile = process.argv.includes("--single-file");
const selectedName =
  process.argv.find((argument) => argument.startsWith("--name="))?.slice("--name=".length) ??
  "fixture.unusual";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(selectedName)) {
  throw new Error("The deterministic fixture filename is invalid.");
}

const fixtureHost =
  process.env.MEDIA_ENGINE_TORRENT_FIXTURE_HOST ?? (await resolveLocalAddress(config.baseUrl));
const payload = stdinMedia ? await readStdin() : Buffer.allocUnsafe(192 * 1024);
if (!stdinMedia) {
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + 7) % 256;
  }
}
if (payload.length < 1 || payload.length > config.maxFileSizeBytes) {
  throw new Error("The deterministic fixture payload is empty or oversized.");
}
const sidecar = Buffer.from("healthy non-media sidecar\n", "utf8");
const torrentPayload = singleFile ? payload : Buffer.concat([sidecar, payload]);

const peerSockets = new Set();
const trace = {
  announces: 0,
  peerConnections: 0,
  peerBytes: 0,
  handshakes: 0,
  pieceRequests: 0,
};
let fixtureHash;
const tracker = createTrackerServer(torrentPayload, () => fixtureHash, peerSockets, trace);
const trackerAddress = await listen(tracker, "0.0.0.0");
const fixture = createFixtureTorrent(
  singleFile
    ? [{ path: selectedName, bytes: payload }]
    : [
        { path: "notes.txt", bytes: sidecar },
        { path: selectedName, bytes: payload },
      ],
  `http://${fixtureHost}:${trackerAddress.port}/announce`,
);
fixtureHash = fixture.hash;
const adapter = new TorrServerAdapter(config);
const lifecycle = new AbortController();
let acquired;
let streamFailure;
let gatewayServer;
let browserBarrier;
let resolveBrowserResult;
let rejectBrowserResult;
const browserResult = new Promise((resolve, reject) => {
  resolveBrowserResult = resolve;
  rejectBrowserResult = reject;
});
const rangeLength = Math.min(4_096, payload.length);
const middleStart = Math.max(0, Math.floor((payload.length - rangeLength) / 2));
const checks = [
  {
    name: "start",
    header: `bytes=0-${rangeLength - 1}`,
    start: 0,
    end: rangeLength - 1,
  },
  {
    name: "middle",
    header: `bytes=${middleStart}-${middleStart + rangeLength - 1}`,
    start: middleStart,
    end: middleStart + rangeLength - 1,
  },
  {
    name: "end",
    header: `bytes=-${rangeLength}`,
    start: payload.length - rangeLength,
    end: payload.length - 1,
  },
  {
    name: "start-repeat",
    header: `bytes=0-${rangeLength - 1}`,
    start: 0,
    end: rangeLength - 1,
  },
  {
    name: "middle-repeat",
    header: `bytes=${middleStart}-${middleStart + rangeLength - 1}`,
    start: middleStart,
    end: middleStart + rangeLength - 1,
  },
];

try {
  await adapter.recoverOwned();
  acquired = await adapter.add({
    kind: "torrent_file",
    bytes: fixture.bytes,
    expectedHash: fixture.hash,
    title: "Media Engine deterministic original-range fixture",
  });
  const metadata =
    acquired.files.length > 0 ? acquired : await adapter.waitForMetadata(fixture.hash);
  assert.equal(metadata.files.length, singleFile ? 1 : 2);
  const sidecarFile = metadata.files.find((file) => file.path.endsWith("notes.txt"));
  const selectedFile = metadata.files.find((file) => file.path.endsWith(selectedName));
  if (singleFile) assert.equal(sidecarFile, undefined);
  else assert.equal(sidecarFile?.length, sidecar.length);
  assert.equal(selectedFile?.length, payload.length);
  assert.notEqual(selectedFile, undefined);
  const target = await adapter.resolveFileTarget(fixture.hash, selectedFile.id);

  assert.equal(target.path.endsWith(selectedName), true);
  assert.equal(target.length, payload.length);

  const sessions = {
    async resolveStreamCapability() {
      return {
        sessionId: "deterministic-smoke-session",
        target,
        expiresAtMs: Date.now() + 60_000,
        signal: lifecycle.signal,
      };
    },
    async failStreamCapability(_sessionId, failure) {
      streamFailure = failure;
    },
  };
  const gateway = new OriginalTorrentStreamGateway(sessions, {
    maxHeaderRetries: 1,
    retryDelayMs: 50,
  });
  gatewayServer = createServer((request, response) => {
    if (browserMode && handleBrowserRequest(request, response)) return;
    void gateway.handle(request, response, "deterministic-capability", "GET").catch((error) => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Gateway failed.");
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
  const gatewayAddress = await listen(gatewayServer, browserMode ? "0.0.0.0" : "127.0.0.1");
  const streamUrl = `http://127.0.0.1:${gatewayAddress.port}/original`;
  for (const check of checks) {
    await verifyRange(streamUrl, check, payload, trace);
  }
  await Promise.all(
    checks.slice(0, 3).map((check) => verifyRange(streamUrl, check, payload, trace)),
  );
  let nativeBrowser;
  if (browserMode) {
    process.stdout.write(`${JSON.stringify({ status: "READY", port: gatewayAddress.port })}\n`);
    const browserTimeout = new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Native browser acceptance timed out.")),
        60_000,
      );
      timer.unref();
    });
    nativeBrowser = await Promise.race([browserResult, browserTimeout]);
    if (nativeBrowser.outcome === "pass") {
      assert.equal(nativeBrowser.played, true);
      assert.equal(nativeBrowser.seeked, true);
      assert.equal(nativeBrowser.videoWidth > 0, true);
      assert.equal(nativeBrowser.duration > 0, true);
    } else {
      assert.equal(allowBrowserRejection, true, JSON.stringify(nativeBrowser));
      assert.match(nativeBrowser.message, /^media error [34]$/u);
    }
  }
  const cancelled = await fetch(streamUrl);
  const reader = cancelled.body?.getReader();
  assert.notEqual(reader, undefined);
  await reader.read();
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(streamFailure, undefined);
} finally {
  lifecycle.abort();
  browserBarrier?.end();
  await close(gatewayServer);
  if (acquired !== undefined) {
    await adapter.release(acquired.lease).catch(() => undefined);
  }
  for (const socket of peerSockets) socket.destroy();
  await close(tracker);
}

await adapter.get(fixture.hash).then(
  () => {
    throw new Error("Deterministic original-range fixture remained after cleanup.");
  },
  (error) => {
    if (error?.code !== "not_found") throw error;
  },
);
process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    hash: fixture.hash,
    bytes: payload.length,
    files: singleFile ? 1 : 2,
    selectedName,
    extensionIndependent: true,
    ranges: checks.map(({ name, start, end }) => ({ name, start, end })),
    concurrentRanges: 3,
    cancellation: "verified",
    ...(browserMode ? { nativeBrowser: await browserResult } : {}),
    cleanup: "verified",
  })}\n`,
);

async function verifyRange(streamUrl, check, expected, trace) {
  const response = await fetch(streamUrl, {
    headers: { Range: check.header },
  });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(
    response.status,
    206,
    `${check.name} status: ${body.toString("utf8")}; trace=${JSON.stringify(trace)}`,
  );
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(
    response.headers.get("content-range"),
    `bytes ${check.start}-${check.end}/${expected.length}`,
  );
  assert.equal(response.headers.get("content-length"), String(body.length));
  assert.deepEqual(body, expected.subarray(check.start, check.end + 1));
}

function handleBrowserRequest(request, response) {
  if (request.url === "/test") {
    const body = browserAcceptanceHtml();
    response.writeHead(200, {
      "Content-Length": String(Buffer.byteLength(body)),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
    return true;
  }
  if (request.url === "/barrier") {
    browserBarrier = response;
    response.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    });
    return true;
  }
  if (request.url === "/result" && request.method === "POST") {
    void readJsonBody(request).then(
      (result) => {
        resolveBrowserResult(result);
        browserBarrier?.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      },
      (error) => {
        rejectBrowserResult(error);
        browserBarrier?.end();
      },
    );
    response.writeHead(204).end();
    return true;
  }
  if (request.url !== "/original") {
    response.writeHead(404, { "Content-Length": "0" }).end();
    return true;
  }
  return false;
}

function browserAcceptanceHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>Media Engine native browser acceptance</title>
<video id="fixture" muted playsinline preload="auto"></video>
<script>
const video = document.querySelector("#fixture");
const wait = (event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(event + " timeout")), 30000);
  video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
  video.addEventListener("error", () => { clearTimeout(timer); reject(new Error("media error " + (video.error?.code ?? "unknown"))); }, { once: true });
});
const report = (value) => fetch("/result", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
(async () => {
  try {
    video.src = "/original";
    await wait("loadedmetadata");
    await video.play();
    const played = !video.paused && video.readyState >= 2;
    const seekedPromise = wait("seeked");
    video.currentTime = Math.min(Math.max(video.duration / 2, 0.1), 2);
    await seekedPromise;
    await report({
      outcome: "pass",
      played,
      seeked: true,
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasAudio: Boolean(video.mozHasAudio || video.audioTracks?.length),
    });
  } catch (error) {
    await report({ outcome: "fail", message: error instanceof Error ? error.message : String(error) });
  }
})();
</script>
<img src="/barrier" alt="">`;
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new Error("Browser result exceeded its bound.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function createTrackerServer(bytes, readHash, sockets, trace) {
  const body = bencodeDictionary([
    ["complete", bencodeInteger(1)],
    ["incomplete", bencodeInteger(0)],
    ["interval", bencodeInteger(60)],
    ["peers", bencodeBytes(Buffer.alloc(0))],
  ]);

  return createServer((request, response) => {
    if (request.method !== "GET" || !request.url?.startsWith("/announce?")) {
      response.writeHead(404, { "Content-Length": "0" });
      response.end();
      return;
    }
    trace.announces += 1;
    const announce = new URL(request.url, "http://tracker.invalid");
    const port = Number(announce.searchParams.get("port"));
    const host = request.socket.remoteAddress?.replace(/^::ffff:/u, "");
    trace.announcedEndpoint = `${host ?? "unknown"}:${port}`;
    if (
      host !== undefined &&
      Number.isSafeInteger(port) &&
      port >= 1 &&
      port <= 65_535 &&
      sockets.size === 0
    ) {
      connectSeeder(host, port, bytes, readHash, sockets, trace);
    }
    response.writeHead(200, {
      "Content-Length": String(body.length),
      "Content-Type": "text/plain",
    });
    response.end(body);
  });
}

function connectSeeder(host, port, bytes, readHash, sockets, trace) {
  const pieceLength = 16_384;
  const pieceCount = Math.ceil(bytes.length / pieceLength);
  const bitfield = Buffer.alloc(Math.ceil(pieceCount / 8));
  for (let index = 0; index < pieceCount; index += 1) {
    bitfield[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }

  const socket = createConnection({ host, port });
  trace.peerConnections += 1;
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  socket.once("error", (error) => {
    trace.peerError = error.message;
  });
  socket.setTimeout(30_000, () => socket.destroy());
  socket.once("connect", () => {
    const hash = readHash();
    if (hash === undefined) {
      socket.destroy();
      return;
    }
    socket.write(createPeerHandshake(hash));
  });
  let handshaken = false;
  let input = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    trace.peerBytes += chunk.length;
    input = Buffer.concat([input, chunk]);
    if (!handshaken) {
      if (input.length < 68) return;
      const hash = readHash();
      const protocol = input.subarray(0, 20);
      const requestedHash = input.subarray(28, 48);
      if (
        protocol[0] !== 19 ||
        protocol.subarray(1).toString("ascii") !== "BitTorrent protocol" ||
        hash === undefined ||
        !requestedHash.equals(Buffer.from(hash, "hex"))
      ) {
        trace.peerError = {
          protocol: protocol.toString("hex"),
          expectedHash: hash,
          requestedHash: requestedHash.toString("hex"),
        };
        socket.destroy();
        return;
      }
      input = input.subarray(68);
      socket.write(Buffer.concat([createPeerMessage(5, bitfield), createPeerMessage(1)]));
      handshaken = true;
      trace.handshakes += 1;
    }

    while (input.length >= 4) {
      const messageLength = input.readUInt32BE(0);
      if (input.length < messageLength + 4) return;
      if (messageLength > 0 && input[4] === 6 && messageLength === 13) {
        trace.pieceRequests += 1;
        const piece = input.readUInt32BE(5);
        const begin = input.readUInt32BE(9);
        const length = input.readUInt32BE(13);
        const start = piece * pieceLength + begin;
        const end = start + length;
        if (length === 0 || length > 16_384 || end > bytes.length) {
          socket.destroy();
          return;
        }
        const header = Buffer.alloc(8);
        header.writeUInt32BE(piece, 0);
        header.writeUInt32BE(begin, 4);
        socket.write(createPeerMessage(7, Buffer.concat([header, bytes.subarray(start, end)])));
      }
      input = input.subarray(messageLength + 4);
    }
  });
}

function createPeerHandshake(hash) {
  return Buffer.concat([
    Buffer.from("\x13BitTorrent protocol", "binary"),
    Buffer.alloc(8),
    Buffer.from(hash, "hex"),
    Buffer.from("-ME0001-DETSEED00001", "ascii"),
  ]);
}

function createPeerMessage(id, payload = Buffer.alloc(0)) {
  const message = Buffer.alloc(5 + payload.length);
  message.writeUInt32BE(1 + payload.length, 0);
  message[4] = id;
  payload.copy(message, 5);
  return message;
}

function createFixtureTorrent(files, announceUrl) {
  const bytes = Buffer.concat(files.map((file) => file.bytes));
  const pieceLength = 16_384;
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += pieceLength) {
    pieces.push(
      createHash("sha1")
        .update(bytes.subarray(offset, offset + pieceLength))
        .digest(),
    );
  }
  const info = bencodeDictionary([
    [
      "files",
      bencodeList(
        files.map((file) =>
          bencodeDictionary([
            ["length", bencodeInteger(file.bytes.length)],
            ["path", bencodeList([bencodeBytes(Buffer.from(file.path, "utf8"))])],
          ]),
        ),
      ),
    ],
    ["name", bencodeBytes(Buffer.from("fixture-root", "utf8"))],
    ["piece length", bencodeInteger(pieceLength)],
    ["pieces", bencodeBytes(Buffer.concat(pieces))],
  ]);
  const torrent = bencodeDictionary([
    ["announce", bencodeBytes(Buffer.from(announceUrl, "utf8"))],
    ["info", info],
  ]);

  return {
    bytes: new Uint8Array(torrent),
    hash: createHash("sha1").update(info).digest("hex"),
  };
}

function bencodeDictionary(entries) {
  return Buffer.concat([
    Buffer.from("d"),
    ...entries.flatMap(([key, value]) => [bencodeBytes(Buffer.from(key)), value]),
    Buffer.from("e"),
  ]);
}

function bencodeInteger(value) {
  return Buffer.from(`i${value}e`);
}

function bencodeList(values) {
  return Buffer.concat([Buffer.from("l"), ...values, Buffer.from("e")]);
}

function bencodeBytes(value) {
  return Buffer.concat([Buffer.from(`${value.length}:`), value]);
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a TCP server address."));
        return;
      }
      resolve(address);
    });
  });
}

function close(server) {
  if (server === undefined || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function resolveLocalAddress(target) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: target.hostname,
      port: Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      const localAddress = socket.localAddress;
      socket.destroy();
      if (localAddress === undefined) {
        reject(new Error("Could not determine the TorrServer-facing local address."));
        return;
      }
      resolve(localAddress);
    });
    socket.once("timeout", () => {
      socket.destroy(new Error("Timed out while resolving the TorrServer-facing address."));
    });
    socket.once("error", reject);
  });
}
