import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import {
  createBitsearchSearchTerm,
  createBitsearchTorrentSearchUrl,
  parseBitsearchTorrentResponse,
} from "./client.js";
import {
  BITSEARCH_INFO_HASH,
  createBitsearchTorrentPayload,
  createEmptyBitsearchTorrentPayload,
} from "./test-helpers.js";

test("parseBitsearchTorrentResponse accepts the bounded observed public schema", () => {
  const releases = parseBitsearchTorrentResponse(
    "bitsearch-test",
    createBitsearchTorrentPayload(),
    "Dune 2021",
    40,
  );

  assert.deepEqual(releases, [
    {
      id: "616c4e220985d20990b5512d",
      infoHash: BITSEARCH_INFO_HASH,
      title: "Dune (2021) [2160p] [WEBRip] x265 EAC3 HDR10 MKV [YTS.MX]",
      sizeBytes: 8_589_934_592,
      category: 2,
      subCategory: 2,
      seeders: 1_050,
      leechers: 372,
      verified: true,
      createdAt: "2021-10-21T10:30:00.000Z",
      updatedAt: "2026-07-24T07:15:51.982Z",
    },
  ]);
});

test("parseBitsearchTorrentResponse preserves an honest empty result", () => {
  assert.deepEqual(
    parseBitsearchTorrentResponse(
      "bitsearch-test",
      createEmptyBitsearchTorrentPayload(),
      "missing 2021",
      40,
    ),
    [],
  );
});

test("parseBitsearchTorrentResponse rejects route/schema drift and invalid records", () => {
  const invalidValues = [
    {},
    { ...createBitsearchTorrentPayload(), success: false },
    { ...createBitsearchTorrentPayload(), query: "Dune" },
    {
      ...createBitsearchTorrentPayload(),
      pagination: { ...createBitsearchTorrentPayload().pagination, page: 2 },
    },
    {
      ...createBitsearchTorrentPayload(),
      results: [{ ...createBitsearchTorrentPayload().results[0], infohash: "not-a-hash" }],
    },
    {
      ...createBitsearchTorrentPayload(),
      results: [{ ...createBitsearchTorrentPayload().results[0], category: "Movies" }],
    },
    {
      ...createBitsearchTorrentPayload(),
      results: [{ ...createBitsearchTorrentPayload().results[0], updatedAt: "yesterday" }],
    },
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => parseBitsearchTorrentResponse("bitsearch-test", value, "Dune 2021", 40),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("createBitsearchTorrentSearchUrl emits bounded category and episode queries", () => {
  const config = {
    baseUrl: "https://bitsearch.test",
    searchPath: "/api/v1/search",
    resultLimit: 25,
  };
  const query = {
    type: "series" as const,
    title: "Game of Thrones",
    year: 2011,
    seasonNumber: 1,
    episodeNumber: 10,
  };
  const url = createBitsearchTorrentSearchUrl(config, query);

  assert.equal(createBitsearchSearchTerm(query), "Game of Thrones 2011 S01E10");
  assert.equal(url.pathname, "/api/v1/search");
  assert.equal(url.searchParams.get("q"), "Game of Thrones 2011 S01E10");
  assert.equal(url.searchParams.get("category"), "3");
  assert.equal(url.searchParams.get("sort"), "relevance");
  assert.equal(url.searchParams.get("order"), "desc");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("limit"), "25");

  assert.equal(
    createBitsearchSearchTerm({
      type: "anime",
      title: "One Piece",
      year: 1999,
      absoluteEpisodeNumber: 1,
    }),
    "One Piece 1999 E01",
  );
});
