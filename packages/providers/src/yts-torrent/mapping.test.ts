import assert from "node:assert/strict";
import { test } from "node:test";

import type { YtsTorrentMovie } from "./client.js";
import { mapYtsTorrentResponse, selectYtsTorrentMovie } from "./mapping.js";

const movie: YtsTorrentMovie = {
  id: 1606,
  imdb: "tt1375666",
  title: "Inception",
  year: 2010,
  sourceUrl: "https://yts.test/movies/inception-2010",
  torrents: [
    {
      hash: "CE9156EB497762F8B7577B71C0647A4B0C3423E1",
      quality: "720p",
      sourceType: "bluray",
      videoCodec: "x264",
      sizeBytes: 1_148_903_752,
      seeders: 23,
      leechers: 2,
      uploadedAt: "2015-10-31T22:21:17.000Z",
    },
    {
      hash: "CE9156EB497762F8B7577B71C0647A4B0C3423E1",
      quality: "720p",
      seeders: 23,
    },
    {
      hash: "224BF45881252643DFC2E71ABC7B2660A21C68C4",
      quality: "1080p",
      sourceType: "web",
      seeders: 0,
    },
  ],
};

test("selectYtsTorrentMovie requires exact IMDb or unambiguous title and year", () => {
  assert.equal(
    selectYtsTorrentMovie([movie], { type: "movie", ids: { imdb: "tt1375666" } }),
    movie,
  );
  assert.equal(
    selectYtsTorrentMovie([movie], { type: "movie", title: "inception", year: 2010 }),
    movie,
  );
  assert.equal(
    selectYtsTorrentMovie([movie], { type: "movie", title: "Inception", year: 2009 }),
    undefined,
  );
  assert.equal(
    selectYtsTorrentMovie([movie, { ...movie, id: 999 }], {
      type: "movie",
      title: "Inception",
      year: 2010,
    }),
    undefined,
  );
});

test("mapYtsTorrentResponse creates deduplicated magnet candidates with honest peer state", () => {
  const query = {
    type: "movie" as const,
    title: "Inception",
    year: 2010,
    ids: { imdb: "tt1375666" },
  };
  const result = mapYtsTorrentResponse("yts-test", movie, query);

  assert.equal(result?.candidates.length, 2);
  assert.deepEqual(result?.item, {
    type: "movie",
    title: "Inception",
    year: 2010,
    ids: { imdb: "tt1375666" },
  });
  assert.deepEqual(result?.candidates[0], {
    id: "yts-test:ce9156eb497762f8b7577b71c0647a4b0c3423e1",
    provider: "yts-test",
    title: "Inception (2010) 720p BLURAY [YTS]",
    infoHash: "CE9156EB497762F8B7577B71C0647A4B0C3423E1",
    sizeBytes: 1_148_903_752,
    publishedAt: "2015-10-31T22:21:17.000Z",
    release: {
      source: "bluray",
      resolution: "720p",
      height: 720,
      videoCodec: "x264",
    },
    peers: {
      seeders: 23,
      leechers: 2,
      checkedAt: result?.candidates[0]?.peers?.checkedAt,
    },
    handoff: {
      kind: "magnet",
      uri: "magnet:?xt=urn:btih:CE9156EB497762F8B7577B71C0647A4B0C3423E1&dn=Inception%20(2010)%20720p%20BLURAY%20%5BYTS%5D",
    },
    availability: "available",
    sourceUrl: "https://yts.test/movies/inception-2010",
  });
  assert.equal(result?.candidates[1]?.availability, "unseeded");
  assert.equal(result?.candidates[1]?.release?.source, "web");
});
