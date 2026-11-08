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

for (const animeKind of ["tv", "ona", "ova", "special", "music", "unknown", undefined] as const) {
  test(`verifies episode coordinates independently of distribution kind: ${animeKind}`, () => {
    const selected = {
      ...query,
      animeKind,
      animeReleaseEpisode: {
        releaseIndex: 1,
        releaseEpisodeNumber: 1,
        releaseEpisodeCounts: [2, 1],
      },
    };
    const catalog = [
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 2, episodeNumber: 1 },
      { seasonNumber: 2, episodeNumber: 2 },
      { seasonNumber: 3, episodeNumber: 4 },
    ];
    assert.deepEqual(verifyAnimeEpisodeSelection(selected, catalog), {
      seasonNumber: 2,
      episodeNumber: 1,
      absoluteEpisodeNumber: 3,
      canonicalSeasonNumber: 2,
      canonicalEpisodeNumber: 1,
      releaseEpisodeNumber: 1,
    });
    assert.equal(
      verifyAnimeEpisodeSelection({ ...selected, animeKind: "movie" }, catalog),
      undefined,
    );
    assert.equal(
      verifyAnimeEpisodeSelection({ ...selected, absoluteEpisodeNumber: 2 }, catalog),
      undefined,
    );
    assert.equal(
      verifyAnimeEpisodeSelection(
        {
          ...selected,
          animeReleaseEpisode: {
            ...selected.animeReleaseEpisode,
            releaseEpisodeNumber: 2,
          },
        },
        catalog,
      ),
      undefined,
    );
    assert.equal(
      verifyAnimeEpisodeSelection(
        selected,
        catalog.filter((episode) => !(episode.seasonNumber === 1 && episode.episodeNumber === 2)),
      ),
      undefined,
    );
  });
}

test("verifyAnimeEpisodeSelection proves a continuous seasonal-to-absolute mapping", () => {
  assert.deepEqual(
    verifyAnimeEpisodeSelection(query, [
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 2, episodeNumber: 1 },
    ]),
    {
      seasonNumber: 2,
      episodeNumber: 1,
      absoluteEpisodeNumber: 3,
      canonicalSeasonNumber: 2,
      canonicalEpisodeNumber: 1,
    },
  );
});

test("maps a split release to provider-native segmented and combined seasons", () => {
  const splitQuery = {
    ...query,
    seasonNumber: 2,
    episodeNumber: 14,
    absoluteEpisodeNumber: 39,
    animeReleaseEpisode: {
      releaseIndex: 2,
      releaseEpisodeNumber: 1,
      releaseEpisodeCounts: [25, 13, 12, 16],
    },
  };
  const catalog = (counts: number[]) =>
    counts.flatMap((count, seasonIndex) =>
      Array.from({ length: count }, (_, episodeIndex) => ({
        seasonNumber: seasonIndex + 1,
        episodeNumber: episodeIndex + 1,
      })),
    );

  assert.deepEqual(verifyAnimeEpisodeSelection(splitQuery, catalog([25, 13, 12, 16])), {
    seasonNumber: 3,
    episodeNumber: 1,
    absoluteEpisodeNumber: 39,
    canonicalSeasonNumber: 2,
    canonicalEpisodeNumber: 14,
    releaseEpisodeNumber: 1,
  });
  assert.deepEqual(verifyAnimeEpisodeSelection(splitQuery, catalog([25, 25, 16])), {
    seasonNumber: 2,
    episodeNumber: 14,
    absoluteEpisodeNumber: 39,
    canonicalSeasonNumber: 2,
    canonicalEpisodeNumber: 14,
    releaseEpisodeNumber: 1,
  });
  assert.deepEqual(verifyAnimeEpisodeSelection(splitQuery, catalog([12])), {
    seasonNumber: 1,
    episodeNumber: 1,
    absoluteEpisodeNumber: 39,
    canonicalSeasonNumber: 2,
    canonicalEpisodeNumber: 14,
    releaseEpisodeNumber: 1,
  });
});

test("rejects inconsistent release evidence and unrelated provider catalogs", () => {
  const splitQuery = {
    ...query,
    seasonNumber: 2,
    episodeNumber: 14,
    absoluteEpisodeNumber: 39,
    animeReleaseEpisode: {
      releaseIndex: 2,
      releaseEpisodeNumber: 1,
      releaseEpisodeCounts: [25, 13, 12, 16],
    },
  };
  const unrelated = Array.from({ length: 11 }, (_, index) => ({
    seasonNumber: 1,
    episodeNumber: index + 1,
  }));

  assert.equal(
    verifyAnimeEpisodeSelection({ ...splitQuery, absoluteEpisodeNumber: 38 }, unrelated),
    undefined,
  );
  assert.equal(verifyAnimeEpisodeSelection(splitQuery, unrelated), undefined);
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
