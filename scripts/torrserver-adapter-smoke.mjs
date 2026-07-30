#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  readOriginalTorrentRuntimeConfig,
  TorrServerAdapter,
} = require("../apps/api/dist/src/original-torrent-runtime/index.js");

const config = readOriginalTorrentRuntimeConfig(process.env);

if (config === undefined) {
  throw new Error("MEDIA_ENGINE_TORRSERVER_URL is required for the isolated adapter smoke.");
}

const adapter = new TorrServerAdapter(config);
const fixture = createFixtureTorrent();
let acquired;

try {
  await adapter.recoverOwned();
  const health = await adapter.health();
  acquired = await adapter.add({
    kind: "torrent_file",
    bytes: fixture.bytes,
    expectedHash: fixture.hash,
    title: "Media Engine deterministic adapter fixture",
  });
  const metadata =
    acquired.files.length > 0 ? acquired : await adapter.waitForMetadata(fixture.hash);
  const target = await adapter.resolveFileTarget(fixture.hash, 1);

  if (
    metadata.files.length !== 1 ||
    metadata.files[0]?.path !== "fixture.txt" ||
    metadata.files[0]?.length !== 7 ||
    target.path !== "fixture.txt" ||
    target.length !== 7
  ) {
    throw new Error("TorrServer returned unexpected deterministic fixture metadata.");
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      version: health.version,
      hash: fixture.hash,
      files: metadata.files.length,
      target: { fileId: target.fileId, path: target.path, length: target.length },
    })}\n`,
  );
} finally {
  if (acquired !== undefined) {
    await adapter.release(acquired.lease).catch(() => undefined);
  }
}

await adapter.get(fixture.hash).then(
  () => {
    throw new Error("Deterministic TorrServer fixture remained after cleanup.");
  },
  (error) => {
    if (error?.code !== "not_found") throw error;
  },
);

function createFixtureTorrent() {
  const payload = Buffer.from("fixture", "utf8");
  const info = bencodeDictionary([
    ["length", bencodeInteger(payload.length)],
    ["name", bencodeBytes(Buffer.from("fixture.txt", "utf8"))],
    ["piece length", bencodeInteger(16_384)],
    ["pieces", bencodeBytes(createHash("sha1").update(payload).digest())],
  ]);
  const bytes = bencodeDictionary([
    ["announce", bencodeBytes(Buffer.from("http://127.0.0.1:9/announce", "utf8"))],
    ["info", info],
  ]);

  return {
    bytes: new Uint8Array(bytes),
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
