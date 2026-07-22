import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { parseAniLibertyRelease, parseAniLibertySearchResponse } from "./client.js";

test("parseAniLibertySearchResponse parses nullable release fields within a result limit", () => {
  const releases = parseAniLibertySearchResponse(
    "aniliberty-streaming",
    [
      {
        id: 10290,
        year: 1999,
        name: { main: "Ван-Пис", english: "One Piece", alternative: null },
        alias: "one-piece",
        is_blocked_by_geo: false,
        is_blocked_by_copyrights: false,
      },
      {
        id: 1210,
        year: 2015,
        name: { main: "Ванпанчмен", english: "One Punch Man" },
      },
    ],
    1,
  );

  assert.deepEqual(releases, [
    {
      id: 10290,
      year: 1999,
      name: { main: "Ван-Пис", english: "One Piece" },
      alias: "one-piece",
      blockedByGeo: false,
      blockedByCopyrights: false,
    },
  ]);
});

test("parseAniLibertyRelease bounds episodes and preserves direct HLS fields", () => {
  const release = parseAniLibertyRelease(
    "aniliberty-streaming",
    {
      id: 10290,
      year: 1999,
      name: { main: "Ван-Пис", english: "One Piece" },
      is_blocked_by_geo: true,
      is_blocked_by_copyrights: false,
      episodes: [
        {
          id: "episode-1",
          name: "Episode 1",
          ordinal: 1,
          hls_480: "https://cdn.test/1/480.m3u8",
          hls_720: "https://cdn.test/1/720.m3u8",
          hls_1080: null,
        },
        {
          id: "episode-2",
          ordinal: 2,
          hls_1080: "https://cdn.test/2/1080.m3u8",
        },
      ],
    },
    1,
  );

  assert.equal(release.blockedByGeo, true);
  assert.deepEqual(release.episodes, [
    {
      id: "episode-1",
      name: "Episode 1",
      ordinal: 1,
      hls480: "https://cdn.test/1/480.m3u8",
      hls720: "https://cdn.test/1/720.m3u8",
    },
  ]);
});

test("AniLiberty parsers reject top-level and complete nested schema drift", () => {
  for (const parse of [
    () => parseAniLibertySearchResponse("aniliberty-streaming", { data: [] }, 10),
    () =>
      parseAniLibertySearchResponse(
        "aniliberty-streaming",
        [{ id: "wrong", year: 1999, name: {} }],
        10,
      ),
    () =>
      parseAniLibertyRelease(
        "aniliberty-streaming",
        {
          id: 1,
          year: 2020,
          name: { main: "Example" },
          episodes: [{ id: "episode", ordinal: "one" }],
        },
        10,
      ),
  ]) {
    assert.throws(parse, (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      assert.equal(error.retryable, false);
      return true;
    });
  }
});
