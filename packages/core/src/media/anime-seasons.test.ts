import assert from "node:assert/strict";
import { test } from "node:test";

import { mapAnimeReleasesToCanonicalSeasons } from "./anime-seasons.js";

test("maps split anime releases into exact canonical season partitions", () => {
  assert.deepEqual(mapAnimeReleasesToCanonicalSeasons([25, 13, 12, 16], [25, 25, 16]), [
    {
      releaseIndex: 0,
      canonicalSeasonNumber: 1,
      canonicalSeasonEpisodeOffset: 0,
      canonicalAbsoluteEpisodeOffset: 0,
    },
    {
      releaseIndex: 1,
      canonicalSeasonNumber: 2,
      canonicalSeasonEpisodeOffset: 0,
      canonicalAbsoluteEpisodeOffset: 25,
    },
    {
      releaseIndex: 2,
      canonicalSeasonNumber: 2,
      canonicalSeasonEpisodeOffset: 13,
      canonicalAbsoluteEpisodeOffset: 38,
    },
    {
      releaseIndex: 3,
      canonicalSeasonNumber: 3,
      canonicalSeasonEpisodeOffset: 0,
      canonicalAbsoluteEpisodeOffset: 50,
    },
  ]);
});

test("allows future canonical seasons but rejects incomplete or crossing partitions", () => {
  assert.equal(mapAnimeReleasesToCanonicalSeasons([12], [24, 12]), undefined);
  assert.equal(mapAnimeReleasesToCanonicalSeasons([13, 12], [12, 13]), undefined);
  assert.deepEqual(mapAnimeReleasesToCanonicalSeasons([12], [12, 12]), [
    {
      releaseIndex: 0,
      canonicalSeasonNumber: 1,
      canonicalSeasonEpisodeOffset: 0,
      canonicalAbsoluteEpisodeOffset: 0,
    },
  ]);
});
