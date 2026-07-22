import assert from "node:assert/strict";
import { test } from "node:test";

import type { JacRedTorrentRelease } from "./client.js";
import { selectJacRedTorrentReleases } from "./matching.js";
import { JACRED_INFO_HASH } from "./test-helpers.js";

const release: JacRedTorrentRelease = {
  title: "Во все тяжкие / Breaking Bad [S01-05] (2008-2013) BDRip",
  name: "Во все тяжкие",
  originalName: "Breaking Bad",
  year: 2008,
  categories: ["serial"],
  seasons: [1, 2, 3, 4, 5],
  seeders: 68,
  infoHash: JACRED_INFO_HASH,
};

test("selectJacRedTorrentReleases requires exact title, year, type, and requested season", () => {
  assert.deepEqual(
    selectJacRedTorrentReleases([release], {
      type: "series",
      title: "breaking bad",
      year: 2008,
      seasonNumber: 1,
    }),
    [release],
  );
  assert.deepEqual(
    selectJacRedTorrentReleases([release], {
      type: "series",
      title: "Во-все тяжкие",
      year: 2008,
      seasonNumber: 5,
    }),
    [release],
  );

  for (const query of [
    { type: "series" as const, title: "Better Call Saul", year: 2008, seasonNumber: 1 },
    { type: "series" as const, title: "Breaking Bad", year: 2009, seasonNumber: 1 },
    { type: "movie" as const, title: "Breaking Bad", year: 2008 },
    { type: "series" as const, title: "Breaking Bad", year: 2008, seasonNumber: 6 },
  ]) {
    assert.deepEqual(selectJacRedTorrentReleases([release], query), []);
  }
});

test("selectJacRedTorrentReleases accepts normalized animation categories for anime", () => {
  const anime = { ...release, categories: ["multfilm", "multserial"], year: 2013 };

  assert.deepEqual(
    selectJacRedTorrentReleases([anime], {
      type: "anime",
      title: "Breaking Bad",
      year: 2013,
      seasonNumber: 1,
    }),
    [anime],
  );
});
