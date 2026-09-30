import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyAnimeEpisodeSelection } from "./anime-episode.js";

const query = {
  type: "anime" as const,
  animeKind: "tv" as const,
  ids: { aniList: "154587", kinopoisk: "5401195" },
  seasonNumber: 2,
  episodeNumber: 1,
  absoluteEpisodeNumber: 3,
};

test("verifyAnimeEpisodeSelection proves a continuous seasonal-to-absolute mapping", () => {
  assert.deepEqual(
    verifyAnimeEpisodeSelection(query, [
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 2, episodeNumber: 1 },
    ]),
    { seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 3 },
  );
});

test("verifyAnimeEpisodeSelection rejects mismatches and incomplete catalog prefixes", () => {
  assert.equal(
    verifyAnimeEpisodeSelection({ ...query, absoluteEpisodeNumber: 2 }, [
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 2, episodeNumber: 1 },
    ]),
    undefined,
  );
  assert.equal(
    verifyAnimeEpisodeSelection(query, [
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 2, episodeNumber: 1 },
    ]),
    undefined,
  );
});
