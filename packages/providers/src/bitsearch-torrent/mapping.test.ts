import assert from "node:assert/strict";
import { test } from "node:test";

import type { BitsearchTorrentRelease } from "./client.js";
import { mapBitsearchTorrentResponse } from "./mapping.js";
import { BITSEARCH_INFO_HASH } from "./test-helpers.js";

const release: BitsearchTorrentRelease = {
  id: "616c4e220985d20990b5512d",
  infoHash: BITSEARCH_INFO_HASH,
  title: "Dune 2021 2160p WEB-DL x265 EAC3 MKV Dolby Vision HDR10+",
  sizeBytes: 8_589_934_592,
  category: 2,
  seeders: 1_050,
  leechers: 372,
  verified: true,
  createdAt: "2021-10-21T10:30:00.000Z",
  updatedAt: "2026-07-24T07:15:51.982Z",
};

test("mapBitsearchTorrentResponse creates deduplicated normalized magnet candidates", () => {
  const query = { type: "movie" as const, title: "Dune", year: 2021 };
  const response = mapBitsearchTorrentResponse(
    "bitsearch-test",
    "https://bitsearch.test",
    [release, { ...release, id: "616c4e220985d20990b5512e" }],
    query,
  );

  assert.deepEqual(response?.item, { type: "movie", title: "Dune", year: 2021 });
  assert.equal(response?.candidates.length, 1);
  assert.deepEqual(response?.candidates[0], {
    id: `bitsearch-test:${BITSEARCH_INFO_HASH.toLowerCase()}`,
    provider: "bitsearch-test",
    title: release.title,
    infoHash: BITSEARCH_INFO_HASH,
    sizeBytes: 8_589_934_592,
    publishedAt: "2021-10-21T10:30:00.000Z",
    release: {
      source: "web",
      resolution: "2160p",
      height: 2160,
      videoCodec: "H.265",
      audioCodec: "E-AC-3",
      container: "mkv",
      hdr: ["Dolby Vision", "HDR10+"],
    },
    peers: {
      seeders: 1_050,
      leechers: 372,
      checkedAt: "2026-07-24T07:15:51.982Z",
    },
    handoff: {
      kind: "magnet",
      uri: `magnet:?xt=urn:btih:${BITSEARCH_INFO_HASH}&dn=${encodeURIComponent(release.title)}`,
    },
    availability: "available",
    sourceUrl: "https://bitsearch.test/torrent/616c4e220985d20990b5512d",
  });
  assert.deepEqual(response?.sourceProviders, [
    { provider: "bitsearch-test", url: "https://bitsearch.test" },
  ]);
});

test("mapBitsearchTorrentResponse associates requested episodes and honest peer state", () => {
  const response = mapBitsearchTorrentResponse(
    "bitsearch-test",
    "https://bitsearch.test",
    [{ ...release, seeders: 0, updatedAt: undefined }],
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
  assert.equal(response?.candidates[0]?.peers?.checkedAt, response?.checkedAt);
  assert.equal(
    mapBitsearchTorrentResponse("bitsearch-test", "https://bitsearch.test", [], response!.query),
    null,
  );

  const unknown = mapBitsearchTorrentResponse(
    "bitsearch-test",
    "https://bitsearch.test",
    [{ ...release, seeders: undefined }],
    { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 1 },
  );
  assert.deepEqual(unknown?.candidates[0]?.episode, { absoluteEpisodeNumber: 1 });
  assert.equal(unknown?.candidates[0]?.availability, "unknown");
});

test("mapBitsearchTorrentResponse normalizes common release labels", () => {
  const variants = [
    "Film 4K UHD BDRip AV1 TrueHD MP4 HDR10",
    "Film 1080p HDTV H.264 DTS AVI",
    "Film 720p DVDRip Xvid FLAC",
    "Film 480p CAMRip MPEG-2 AAC",
    "Film release",
  ].map((title, index): BitsearchTorrentRelease => ({
    ...release,
    title,
    infoHash: index.toString(16).padStart(40, "0").toUpperCase(),
    createdAt: undefined,
  }));

  const response = mapBitsearchTorrentResponse(
    "bitsearch-test",
    "https://bitsearch.test",
    variants,
    { type: "movie", title: "Film", year: 2021 },
  );

  assert.deepEqual(
    response?.candidates.map((candidate) => candidate.release),
    [
      {
        source: "bluray",
        resolution: "2160p",
        height: 2160,
        videoCodec: "AV1",
        audioCodec: "TrueHD",
        container: "mp4",
        hdr: ["HDR10"],
      },
      {
        source: "hdtv",
        resolution: "1080p",
        height: 1080,
        videoCodec: "H.264",
        audioCodec: "DTS",
        container: "avi",
      },
      {
        source: "dvd",
        resolution: "720p",
        height: 720,
        videoCodec: "Xvid",
        audioCodec: "FLAC",
      },
      {
        source: "cam",
        resolution: "480p",
        height: 480,
        videoCodec: "MPEG-2",
        audioCodec: "AAC",
      },
      { source: "unknown" },
    ],
  );
});
