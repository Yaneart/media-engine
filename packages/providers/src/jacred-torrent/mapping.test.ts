import assert from "node:assert/strict";
import { test } from "node:test";

import type { JacRedTorrentRelease } from "./client.js";
import { mapJacRedTorrentResponse } from "./mapping.js";
import { JACRED_INFO_HASH } from "./test-helpers.js";

const release: JacRedTorrentRelease = {
  title: "Дюна / Dune (2021) WEB-DL H.265 2160p MKV HDR10+",
  name: "Дюна",
  originalName: "Dune",
  year: 2021,
  categories: ["movie"],
  seasons: [],
  quality: 2160,
  qualityLabel: "4K",
  videoType: "hdr",
  sizeBytes: 44_452_911_513,
  seeders: 296,
  peers: 13,
  createdAt: "2021-10-25T00:00:00.000Z",
  infoHash: JACRED_INFO_HASH,
  sourceUrl: "https://rutracker.org/forum/viewtopic.php?t=6124572",
};

test("mapJacRedTorrentResponse creates deduplicated normalized magnet candidates", () => {
  const query = { type: "movie" as const, title: "Dune", year: 2021 };
  const response = mapJacRedTorrentResponse(
    "jacred-test",
    "https://api.jacred.test",
    [release, { ...release, sourceUrl: "https://mirror.test/release" }],
    query,
  );

  assert.deepEqual(response?.item, {
    type: "movie",
    title: "Дюна",
    originalTitle: "Dune",
    year: 2021,
  });
  assert.equal(response?.candidates.length, 1);
  assert.deepEqual(response?.candidates[0], {
    id: `jacred-test:${JACRED_INFO_HASH.toLowerCase()}`,
    provider: "jacred-test",
    title: release.title,
    infoHash: JACRED_INFO_HASH,
    sizeBytes: 44_452_911_513,
    publishedAt: "2021-10-25T00:00:00.000Z",
    release: {
      source: "web",
      resolution: "4K",
      height: 2160,
      videoCodec: "H.265",
      container: "mkv",
      hdr: ["HDR10+"],
    },
    peers: {
      seeders: 296,
      leechers: 13,
      checkedAt: response?.candidates[0]?.peers?.checkedAt,
    },
    handoff: {
      kind: "magnet",
      uri: `magnet:?xt=urn:btih:${JACRED_INFO_HASH}&dn=${encodeURIComponent(release.title)}`,
    },
    availability: "available",
    sourceUrl: "https://rutracker.org/forum/viewtopic.php?t=6124572",
  });
  assert.deepEqual(response?.sourceProviders, [
    { provider: "jacred-test", url: "https://api.jacred.test" },
  ]);
});

test("mapJacRedTorrentResponse associates season packs and preserves honest peer state", () => {
  const response = mapJacRedTorrentResponse(
    "jacred-test",
    "https://api.jacred.test",
    [{ ...release, seeders: 0 }],
    { type: "series", title: "Dune", year: 2021, seasonNumber: 2 },
  );

  assert.deepEqual(response?.candidates[0]?.episode, { seasonNumber: 2 });
  assert.equal(response?.candidates[0]?.availability, "unseeded");
  assert.equal(
    mapJacRedTorrentResponse("jacred-test", "https://api.jacred.test", [], response!.query),
    null,
  );
});

test("mapJacRedTorrentResponse normalizes common source, codec, container, and HDR labels", () => {
  const variants = [
    { title: "Film BDRip H.264 MP4 Dolby Vision HDR10", quality: 1080, seeders: undefined },
    { title: "Film HDTV Xvid AVI", quality: 720, seeders: 1 },
    { title: "Film DVDRip MPEG-2", seeders: 1 },
    { title: "Film CAMRip AV1", seeders: 1 },
    { title: "Film release", seeders: 1 },
  ].map((variant, index): JacRedTorrentRelease => {
    const { seeders, ...metadata } = variant;
    const {
      quality: _quality,
      qualityLabel: _qualityLabel,
      seeders: _seeders,
      videoType: _videoType,
      sourceUrl: _sourceUrl,
      ...baseRelease
    } = release;

    return {
      ...baseRelease,
      ...metadata,
      ...(seeders !== undefined ? { seeders } : {}),
      ...(index === 4 ? { videoType: "hdr" } : {}),
      infoHash: index.toString(16).padStart(40, "0").toUpperCase(),
    };
  });

  const response = mapJacRedTorrentResponse("jacred-test", "https://api.jacred.test", variants, {
    type: "movie",
    title: "Film",
    year: 2021,
  });

  assert.deepEqual(
    response?.candidates.map((candidate) => ({
      source: candidate.release?.source,
      resolution: candidate.release?.resolution,
      codec: candidate.release?.videoCodec,
      container: candidate.release?.container,
      hdr: candidate.release?.hdr,
      availability: candidate.availability,
    })),
    [
      {
        source: "bluray",
        resolution: "1080p",
        codec: "H.264",
        container: "mp4",
        hdr: ["Dolby Vision", "HDR10"],
        availability: "unknown",
      },
      {
        source: "hdtv",
        resolution: "720p",
        codec: "Xvid",
        container: "avi",
        hdr: undefined,
        availability: "available",
      },
      {
        source: "dvd",
        resolution: undefined,
        codec: "MPEG-2",
        container: undefined,
        hdr: undefined,
        availability: "available",
      },
      {
        source: "cam",
        resolution: undefined,
        codec: "AV1",
        container: undefined,
        hdr: undefined,
        availability: "available",
      },
      {
        source: "unknown",
        resolution: undefined,
        codec: undefined,
        container: undefined,
        hdr: ["HDR"],
        availability: "available",
      },
    ],
  );
});
