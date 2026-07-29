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

const fixtureHost =
  process.env.MEDIA_ENGINE_TORRENT_FIXTURE_HOST ?? (await resolveLocalAddress(config.baseUrl));
const payload = Buffer.allocUnsafe(192 * 1024);
for (let index = 0; index < payload.length; index += 1) {
  payload[index] = (index * 31 + 7) % 256;
}

const peerSockets = new Set();
const trace = {
  announces: 0,
  peerConnections: 0,
  peerBytes: 0,
  handshakes: 0,
  pieceRequests: 0,
};
let fixtureHash;
const tracker = createTrackerServer(payload, () => fixtureHash, peerSockets, trace);
const trackerAddress = await listen(tracker, "0.0.0.0");
const fixture = createFixtureTorrent(
  payload,
  `http://${fixtureHost}:${trackerAddress.port}/announce`,
);
fixtureHash = fixture.hash;
const adapter = new TorrServerAdapter(config);
const lifecycle = new AbortController();
let streamFailure;
let gatewayServer;
const checks = [
  { name: "start", header: "bytes=0-4095", start: 0, end: 4095 },
  {
    name: "middle",
    header: "bytes=98304-102399",
    start: 98_304,
    end: 102_399,
  },
  {
    name: "end",
    header: "bytes=-4096",
    start: payload.length - 4096,
    end: payload.length - 1,
  },
];

try {
  await adapter.drop(fixture.hash).catch(() => undefined);
  const added = await adapter.add({
    kind: "torrent_file",
    bytes: fixture.bytes,
    expectedHash: fixture.hash,
    title: "Media Engine deterministic original-range fixture",
  });
  const metadata = added.files.length > 0 ? added : await adapter.waitForMetadata(fixture.hash);
  const target = await adapter.resolveFileTarget(fixture.hash, 1);

  assert.deepEqual(metadata.files, [{ id: 1, path: "fixture.bin", length: payload.length }]);
  assert.equal(target.path, "fixture.bin");
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
    void gateway.handle(request, response, "deterministic-capability", "GET").catch((error) => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Gateway failed.");
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
  const gatewayAddress = await listen(gatewayServer, "127.0.0.1");
  const streamUrl = `http://127.0.0.1:${gatewayAddress.port}/original`;
  for (const check of checks) {
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
      `bytes ${check.start}-${check.end}/${payload.length}`,
    );
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.deepEqual(body, payload.subarray(check.start, check.end + 1));
  }

  assert.equal(streamFailure, undefined);
} finally {
  lifecycle.abort();
  await close(gatewayServer);
  await adapter.drop(fixture.hash).catch(() => undefined);
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
    ranges: checks.map(({ name, start, end }) => ({ name, start, end })),
    cleanup: "verified",
  })}\n`,
);

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

function createFixtureTorrent(bytes, announceUrl) {
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
    ["length", bencodeInteger(bytes.length)],
    ["name", bencodeBytes(Buffer.from("fixture.bin", "utf8"))],
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
