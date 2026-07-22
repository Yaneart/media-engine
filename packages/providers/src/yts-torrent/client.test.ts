import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createYtsTorrentSearchUrl, parseYtsTorrentResponse } from "./client.js";
import { createYtsTorrentPayload } from "./test-helpers.js";

test("parseYtsTorrentResponse accepts bounded movie releases and normalizes fields", () => {
  const movies = parseYtsTorrentResponse("yts-test", createYtsTorrentPayload(), 10);

  assert.deepEqual(movies, [
    {
      id: 1606,
      imdb: "tt1375666",
      title: "Inception",
      year: 2010,
      sourceUrl: "https://yts.test/movies/inception-2010",
      torrents: [
        {
          hash: "CE9156EB497762F8B7577B71C0647A4B0C3423E1",
          torrentUrl: "https://yts.test/torrent/inception-720p",
          quality: "720p",
          sourceType: "bluray",
          videoCodec: "x264",
          sizeBytes: 1_148_903_752,
          seeders: 23,
          leechers: 2,
          uploadedAt: "2015-10-31T23:01:17.000Z",
        },
      ],
    },
  ]);
});

test("parseYtsTorrentResponse preserves honest empty results", () => {
  assert.deepEqual(
    parseYtsTorrentResponse("yts-test", { status: "ok", data: { movie_count: 0 } }, 10),
    [],
  );
});

test("parseYtsTorrentResponse rejects schema drift and unsafe output URLs", () => {
  const invalidValues = [
    {},
    { status: "error", data: {} },
    { status: "ok", data: { movie_count: 1, movies: [] } },
    { status: "ok", data: { movie_count: 1, movies: [null] } },
    {
      status: "ok",
      data: {
        movie_count: 1,
        movies: [
          {
            id: 1,
            imdb_code: "tt1375666",
            title: "Inception",
            year: 2010,
            url: "http://127.0.0.1/private",
            torrents: [],
          },
        ],
      },
    },
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseYtsTorrentResponse("yts-test", value, 10),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("createYtsTorrentSearchUrl emits one bounded sorted query", () => {
  assert.equal(
    createYtsTorrentSearchUrl(
      { baseUrl: "https://movies-api.test", resultLimit: 7 },
      "  tt1375666  ",
    ).href,
    "https://movies-api.test/api/v2/list_movies.json?query_term=tt1375666&limit=7&sort_by=seeds&order_by=desc",
  );
});
