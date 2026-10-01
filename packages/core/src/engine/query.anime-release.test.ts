import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStreamQuery, validateStreamQuery } from "./query.js";

const query = {
  type: "anime" as const,
  animeKind: "tv" as const,
  ids: { aniList: "119661" },
  seasonNumber: 2,
  episodeNumber: 14,
  absoluteEpisodeNumber: 39,
  animeReleaseEpisode: {
    releaseIndex: 2,
    releaseEpisodeNumber: 1,
    releaseEpisodeCounts: [25, 13, 12, 16],
  },
};

test("normalizes and validates explicit anime release episode evidence", () => {
  const normalized = normalizeStreamQuery(query);
  validateStreamQuery(normalized);
  assert.deepEqual(normalized.animeReleaseEpisode, query.animeReleaseEpisode);
  assert.notEqual(
    normalized.animeReleaseEpisode?.releaseEpisodeCounts,
    query.animeReleaseEpisode.releaseEpisodeCounts,
  );
});

test("rejects anime release evidence that conflicts with the absolute episode", () => {
  assert.throws(
    () => validateStreamQuery({ ...query, absoluteEpisodeNumber: 38 }),
    /must identify the same explicit episodic anime episode/u,
  );
});
