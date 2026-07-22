import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createJacRedTorrentSearchUrl, parseJacRedTorrentResponse } from "./client.js";
import { createJacRedTorrentPayload, JACRED_INFO_HASH } from "./test-helpers.js";

test("parseJacRedTorrentResponse accepts bounded nullable release metadata", () => {
  const releases = parseJacRedTorrentResponse("jacred-test", createJacRedTorrentPayload(), 40);

  assert.deepEqual(releases, [
    {
      title: "Дюна / Dune: Part One (2021) UHD BDRip-HEVC 2160p MKV | HDR10 | Дубляж",
      name: "Дюна",
      originalName: "Dune: Part One",
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
    },
  ]);
});

test("parseJacRedTorrentResponse preserves honest empty and unavailable-magnet results", () => {
  assert.deepEqual(
    parseJacRedTorrentResponse(
      "jacred-test",
      { query: "missing", total: 0, loaded: 10, limit: 40, open: true, results: [] },
      40,
    ),
    [],
  );

  const payload = createJacRedTorrentPayload();
  payload.results[0]!.magnet_available = false;
  payload.results[0]!.magnet = "";
  assert.deepEqual(parseJacRedTorrentResponse("jacred-test", payload, 40), []);
});

test("parseJacRedTorrentResponse rejects route/schema drift and unsafe handoffs", () => {
  const invalidValues = [
    {},
    { query: "Dune", total: 1, loaded: 1, limit: 40, open: true, results: [] },
    { query: "Dune", total: 1, loaded: 1, limit: 40, open: true, results: [null] },
    {
      ...createJacRedTorrentPayload(),
      results: [
        { ...createJacRedTorrentPayload().results[0], magnet: "https://tracker.test/file" },
      ],
    },
    {
      ...createJacRedTorrentPayload(),
      results: [{ ...createJacRedTorrentPayload().results[0], magnet: ":" }],
    },
    {
      ...createJacRedTorrentPayload(),
      results: [{ ...createJacRedTorrentPayload().results[0], created_at: "yesterday" }],
    },
    {
      ...createJacRedTorrentPayload(),
      results: [
        {
          ...createJacRedTorrentPayload().results[0],
          source_url: "http://127.0.0.1/private",
        },
      ],
    },
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseJacRedTorrentResponse("jacred-test", value, 40),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("parseJacRedTorrentResponse reports a closed public API as unavailable", () => {
  assert.throws(
    () =>
      parseJacRedTorrentResponse(
        "jacred-test",
        { query: "Dune", total: 0, loaded: 0, limit: 40, open: false, results: [] },
        40,
      ),
    (error) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      error.retryable === true,
  );
});

test("createJacRedTorrentSearchUrl emits the observed bounded public route", () => {
  assert.equal(
    createJacRedTorrentSearchUrl(
      { baseUrl: "https://api.jacred.test", searchPath: "/api/search", resultLimit: 25 },
      { type: "series", title: "  Во все тяжкие  ", year: 2008, seasonNumber: 1 },
    ).href,
    "https://api.jacred.test/api/search?query=%D0%92%D0%BE+%D0%B2%D1%81%D0%B5+%D1%82%D1%8F%D0%B6%D0%BA%D0%B8%D0%B5&year=2008&exact=true&sort=sid&category=serial&limit=25&season=1",
  );

  assert.equal(
    createJacRedTorrentSearchUrl(
      { baseUrl: "https://api.jacred.test", searchPath: "/custom/search", resultLimit: 10 },
      { type: "anime", title: "Атака титанов", year: 2013 },
    ).searchParams.get("category"),
    "anime",
  );
});
