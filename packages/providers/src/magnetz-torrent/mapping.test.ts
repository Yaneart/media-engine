import assert from "node:assert/strict";
import { test } from "node:test";

import type { MagnetzTorrentRelease } from "./client.js";
import { mapMagnetzTorrentResponse } from "./mapping.js";
import { MAGNETZ_INFO_HASH } from "./test-helpers.js";

const release: MagnetzTorrentRelease = {
  sqid: "xRTTwe",
  infoHash: MAGNETZ_INFO_HASH,
  title: "Inception 2010 2160p BluRay x265 EAC3 MKV Dolby Vision HDR10+",
  sizeBytes: 8_158_598_962,
  seeders: 26,
  leechers: 12,
  verified: true,
  createdAt: "2026-06-28T20:51:14.000Z",
  sourceUrl: "https://magnetz.test/xRTTwe",
};

test("mapMagnetzTorrentResponse creates deduplicated normalized magnet candidates", () => {
  const query = { type: "movie" as const, title: "Inception", year: 2010 };
  const response = mapMagnetzTorrentResponse(
    "magnetz-test",
    "https://magnetz.test",
    [release, { ...release, sqid: "second" }],
    query,
  );

  assert.deepEqual(response?.item, { type: "movie", title: "Inception", year: 2010 });
  assert.equal(response?.candidates.length, 1);
  assert.deepEqual(response?.candidates[0], {
    id: `magnetz-test:${MAGNETZ_INFO_HASH.toLowerCase()}`,
    provider: "magnetz-test",
    title: release.title,
    infoHash: MAGNETZ_INFO_HASH,
    sizeBytes: 8_158_598_962,
    publishedAt: "2026-06-28T20:51:14.000Z",
    release: {
      source: "bluray",
      resolution: "2160p",
      height: 2160,
      videoCodec: "H.265",
      audioCodec: "E-AC-3",
      container: "mkv",
      hdr: ["Dolby Vision", "HDR10+"],
    },
    peers: {
      seeders: 26,
      leechers: 12,
      checkedAt: response?.checkedAt,
    },
    handoff: {
      kind: "magnet",
      uri: `magnet:?xt=urn:btih:${MAGNETZ_INFO_HASH}&dn=${encodeURIComponent(release.title)}`,
    },
    availability: "available",
    sourceUrl: "https://magnetz.test/xRTTwe",
  });
  assert.deepEqual(response?.sourceProviders, [
    { provider: "magnetz-test", url: "https://magnetz.test" },
  ]);
});

test("mapMagnetzTorrentResponse associates episodes and honest unseeded state", () => {
  const response = mapMagnetzTorrentResponse(
    "magnetz-test",
    "https://magnetz.test",
    [{ ...release, seeders: 0 }],
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 10,
    },
  );

  assert.deepEqual(response?.candidates[0]?.episode, { seasonNumber: 1, episodeNumber: 10 });
  assert.equal(response?.candidates[0]?.availability, "unseeded");
  assert.equal(
    mapMagnetzTorrentResponse("magnetz-test", "https://magnetz.test", [], response!.query),
    null,
  );
});
