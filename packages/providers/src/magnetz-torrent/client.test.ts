import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createMagnetzTorrentSearchUrl, parseMagnetzTorrentResponse } from "./client.js";
import {
  createEmptyMagnetzTorrentPayload,
  createMagnetzTorrentPayload,
  MAGNETZ_INFO_HASH,
} from "./test-helpers.js";

const config = {
  baseUrl: "https://magnetz.test",
  searchPath: "/api/magnets/search",
};

test("parseMagnetzTorrentResponse accepts the bounded observed public schema", () => {
  const releases = parseMagnetzTorrentResponse(
    "magnetz-test",
    createMagnetzTorrentPayload(),
    "Inception 2010",
    config,
    25,
  );

  assert.deepEqual(releases, [
    {
      sqid: "xRTTwe",
      infoHash: MAGNETZ_INFO_HASH,
      title: "Inception 2010 REPACK 1080p BluRay x265 EAC3 MKV HDR10-YAWNTiC",
      sizeBytes: 8_158_598_962,
      seeders: 26,
      leechers: 12,
      verified: true,
      createdAt: "2026-06-28T20:51:14.000Z",
      sourceUrl: "https://magnetz.test/xRTTwe",
    },
  ]);
});

test("parseMagnetzTorrentResponse preserves an honest empty result", () => {
  assert.deepEqual(
    parseMagnetzTorrentResponse(
      "magnetz-test",
      createEmptyMagnetzTorrentPayload(),
      "missing 2021",
      config,
      25,
    ),
    [],
  );
});

test("parseMagnetzTorrentResponse rejects pagination/schema drift and unsafe records", () => {
  const payload = createMagnetzTorrentPayload();
  const invalidValues = [
    {},
    { ...payload, meta: { ...payload.meta, query: "Inception" } },
    { ...payload, meta: { ...payload.meta, current_page: 2 } },
    { ...payload, links: { ...payload.links, prev: "/api/magnets/search?page=1" } },
    { ...payload, data: Array.from({ length: 26 }, () => payload.data[0]) },
    { ...payload, data: [{ ...payload.data[0], score: 101 }] },
    { ...payload, data: [{ ...payload.data[0], info_hash: "not-a-hash" }] },
    {
      ...payload,
      data: [{ ...payload.data[0], magnet_link: `magnet:?xt=urn:btih:${"1".repeat(40)}` }],
    },
    { ...payload, data: [{ ...payload.data[0], web_url: "http://127.0.0.1/private" }] },
    { ...payload, data: [{ ...payload.data[0], created_at: "yesterday" }] },
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseMagnetzTorrentResponse("magnetz-test", value, "Inception 2010", config, 25),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("parseMagnetzTorrentResponse bounds output below the fixed upstream page size", () => {
  const payload = createMagnetzTorrentPayload();
  payload.data.push({
    ...payload.data[0]!,
    sqid: "second",
    info_hash: "1".repeat(40),
    magnet_link: `magnet:?xt=urn:btih:${"1".repeat(40)}`,
    web_url: "https://magnetz.test/second",
  });
  payload.meta.total = 2;
  payload.meta.to = 2;

  assert.equal(
    parseMagnetzTorrentResponse("magnetz-test", payload, "Inception 2010", config, 1).length,
    1,
  );
});

test("createMagnetzTorrentSearchUrl emits one bounded first-page query", () => {
  assert.equal(
    createMagnetzTorrentSearchUrl(config, "Game of Thrones 2011 S01E10").href,
    "https://magnetz.test/api/magnets/search?query=Game+of+Thrones+2011+S01E10&page=1",
  );
});
