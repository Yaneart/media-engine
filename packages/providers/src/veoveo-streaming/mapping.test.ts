import assert from "node:assert/strict";
import { test } from "node:test";

import type { VeoVeoCatalogItem } from "./client.js";
import { mapVeoVeoAvailability } from "./mapping.js";

const sourceUrl = "https://lookup.test/api/players?kinopoisk=4541515&n=0";
const expiresAt = "2026-08-22T12:05:00.000Z";
const checkedAt = "2026-08-22T12:00:00.000Z";

test("mapVeoVeoAvailability maps direct HTTPS HLS movie variants only", () => {
  const result = mapVeoVeoAvailability(
    "veoveo-streaming",
    "31869",
    [
      createItem(0, 0, [
        { title: "720p", url: "https://cdn.test/movie/master.m3u8?sig=x" },
        { title: "JSON", url: "https://cdn.test/movie/source.json" },
        { title: "unsafe", url: "http://127.0.0.1/movie.m3u8" },
      ]),
    ],
    { type: "movie", title: "Movie", ids: { kinopoisk: "4541515" } },
    { source: "kinopoisk", id: "4541515" },
    sourceUrl,
    expiresAt,
    checkedAt,
  );

  assert.equal(result?.options.length, 1);
  assert.equal(result?.options[0]?.player.kind, "hls");
  assert.deepEqual(result?.options[0]?.quality, { label: "720p", height: 720 });
  assert.equal(result?.options[0]?.translation?.title, "VeoVeo");
  assert.equal(result?.options[0]?.expiresAt, expiresAt);
});

test("mapVeoVeoAvailability selects an exact series episode and merges duplicate rows", () => {
  const result = mapVeoVeoAvailability(
    "veoveo-streaming",
    "31869",
    [
      createItem(3, 1, [{ title: "480p", url: "https://cdn.test/s03e01/480.m3u8" }]),
      createItem(3, 1, [{ title: "720", url: "https://cdn.test/s03e01/720.m3u8" }]),
      createItem(3, 2, [{ url: "https://cdn.test/s03e02/master.m3u8" }]),
    ],
    {
      type: "series",
      ids: { kinopoisk: "4541515", imdb: "tt14688458" },
      seasonNumber: 3,
      episodeNumber: 1,
    },
    { source: "kinopoisk", id: "4541515" },
    sourceUrl,
    expiresAt,
    checkedAt,
  );

  assert.equal(result?.episodes?.length, 1);
  assert.equal(result?.options.length, 2);
  assert.deepEqual(
    result?.options.map((option) => option.episode),
    [
      { seasonNumber: 3, episodeNumber: 1 },
      { seasonNumber: 3, episodeNumber: 1 },
    ],
  );
  assert.deepEqual(result?.sourceProviders[0]?.ids, {
    kinopoisk: "4541515",
    imdb: "tt14688458",
  });
});

test("mapVeoVeoAvailability treats non-quality variant titles as translation names", () => {
  const result = mapVeoVeoAvailability(
    "veoveo-streaming",
    "31869",
    [createItem(3, 1, [{ title: "LostFilm", url: "https://cdn.test/s03e01/master.m3u8" }])],
    { type: "series", ids: { kinopoisk: "4541515" }, seasonNumber: 3, episodeNumber: 1 },
    { source: "kinopoisk", id: "4541515" },
    sourceUrl,
    expiresAt,
    checkedAt,
  );

  assert.deepEqual(result?.options[0]?.quality, { label: "Auto" });
  assert.deepEqual(result?.options[0]?.translation, {
    title: "LostFilm",
    type: "unknown",
    team: "LostFilm",
  });
});

test("mapVeoVeoAvailability returns null when no direct matching HLS exists", () => {
  assert.equal(
    mapVeoVeoAvailability(
      "veoveo-streaming",
      "31869",
      [createItem(1, 1, [{ url: "https://cdn.test/source.json" }])],
      { type: "series", ids: { imdb: "tt14688458" }, seasonNumber: 2, episodeNumber: 1 },
      { source: "imdb", id: "tt14688458" },
      sourceUrl,
      expiresAt,
      checkedAt,
    ),
    null,
  );
});

function createItem(
  seasonNumber: number,
  episodeNumber: number,
  variants: VeoVeoCatalogItem["variants"],
): VeoVeoCatalogItem {
  return { seasonNumber, episodeNumber, title: `Episode ${episodeNumber}`, variants };
}
