import assert from "node:assert/strict";
import { test } from "node:test";

import type { EngineWarning } from "../response/index.js";
import { DefaultMergeStrategy } from "./strategy.js";
import { providerDetailsResult } from "./strategy.test-helpers.js";

const strategy = new DefaultMergeStrategy();

test("selects localized details titles and descriptions when language is explicit", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("cinemeta", {
        id: "one-piece-en",
        type: "anime",
        title: "One Piece",
        description: "A much longer English description about pirates and adventure.",
      }),
      providerDetailsResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        description: "Русское описание приключений пиратов.",
      }),
    ],
    { query: { type: "anime", language: "ru" }, language: "ru" },
  );

  assert.equal(details?.title, "Ван-Пис");
  assert.equal(details?.description, "Русское описание приключений пиратов.");
});

test("prefers a localized details title corroborated by multiple providers", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("kinobd", {
        id: "kinobd-death-note",
        type: "anime",
        title: "Тетрадь смерти",
        originalTitle: "Desu noto",
        alternativeTitles: ["Desu noto"],
      }),
      providerDetailsResult("cinemeta", {
        id: "cinemeta-death-note",
        type: "anime",
        title: "Death Note",
      }),
      providerDetailsResult("shikimori", {
        id: "shikimori-death-note",
        type: "anime",
        title: "Тетрадь смерти",
        originalTitle: "Death Note",
        alternativeTitles: ["Death Note", "デスノート"],
      }),
    ],
    { query: { type: "anime", language: "en" }, language: "en" },
  );

  assert.equal(details?.title, "Death Note");
});

test("returns null when there are no details results", () => {
  assert.equal(strategy.mergeDetails([], {}), null);
});

test("selects details primary result by provider priority", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "IMDb Interstellar",
        ids: { imdb: "tt0816692" },
      }),
      providerDetailsResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "TMDB Interstellar",
        ids: { tmdb: "157336" },
      }),
    ],
    {},
  );

  assert.equal(details?.id, "tmdb-157336");
  assert.equal(details?.title, "TMDB Interstellar");
  assert.deepEqual(details?.ids, { tmdb: "157336", imdb: "tt0816692" });
});

test("merges details ids ratings genres images and source providers", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "Interstellar",
        ids: { tmdb: "157336" },
        ratings: [{ source: "tmdb", value: 8.4, max: 10 }],
        genres: [{ name: "Science Fiction" }],
        poster: { url: "https://img.example/poster-small.jpg", type: "poster", width: 300 },
        images: [{ url: "https://img.example/tmdb-backdrop.jpg", type: "backdrop" }],
      }),
      providerDetailsResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "Interstellar",
        ids: { imdb: "tt0816692" },
        ratings: [{ source: "imdb", value: 8.7, max: 10 }],
        genres: [{ name: "Drama" }],
        poster: { url: "https://img.example/poster-large.jpg", type: "poster", width: 900 },
        images: [{ url: "https://img.example/imdb-logo.jpg", type: "logo" }],
      }),
    ],
    {},
  );

  assert.deepEqual(details?.ids, { tmdb: "157336", imdb: "tt0816692" });
  assert.deepEqual(
    details?.ratings?.map((rating) => rating.source),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(
    details?.genres?.map((genre) => genre.name),
    ["Science Fiction", "Drama"],
  );
  assert.equal(details?.poster?.url, "https://img.example/poster-large.jpg");
  assert.deepEqual(
    details?.images?.map((image) => image.url),
    [
      "https://img.example/poster-small.jpg",
      "https://img.example/tmdb-backdrop.jpg",
      "https://img.example/poster-large.jpg",
      "https://img.example/imdb-logo.jpg",
    ],
  );
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["tmdb", "imdb"],
  );
});

test("keeps details persons seasons and episodes from primary provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-series",
        type: "series",
        title: "Primary Series",
        persons: [
          {
            person: { name: "Primary Actor" },
            roles: ["actor"],
          },
        ],
        seasons: [{ number: 1, title: "Primary Season" }],
      }),
      providerDetailsResult("imdb", {
        id: "imdb-series",
        type: "series",
        title: "Secondary Series",
        persons: [
          {
            person: { name: "Secondary Actor" },
            roles: ["actor"],
          },
        ],
        seasons: [{ number: 1, title: "Secondary Season" }],
      }),
    ],
    {},
  );

  assert.equal(details?.type, "series");

  if (details === null || details.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(details.persons?.[0]?.person.name, "Primary Actor");
  assert.equal(details.seasons?.[0]?.title, "Primary Season");
});

test("fills series status and counters from secondary details provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("kinobd", {
        id: "kinobd-got",
        type: "series",
        title: "Игра престолов",
        ids: { kinopoisk: "464963", imdb: "tt0944947" },
      }),
      providerDetailsResult("cinemeta", {
        id: "cinemeta-got",
        type: "series",
        title: "Game of Thrones",
        ids: { imdb: "tt0944947", tmdb: "1399" },
        status: "ended",
        episodesCount: 73,
        seasonsCount: 8,
      }),
    ],
    {},
  );

  assert.equal(details?.type, "series");

  if (!details || details.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(details.status, "ended");
  assert.equal(details.episodesCount, 73);
  assert.equal(details.seasonsCount, 8);
});

test("skips unknown details status when another provider has a meaningful status", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("primary", {
        id: "primary-got",
        type: "series",
        title: "Game of Thrones",
        status: "unknown",
        ids: { imdb: "tt0944947" },
      }),
      providerDetailsResult("secondary", {
        id: "secondary-got",
        type: "series",
        title: "Game of Thrones",
        status: "ended",
        ids: { imdb: "tt0944947" },
      }),
    ],
    {},
  );

  assert.equal(details?.status, "ended");
});

test("keeps anime episodes from primary provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("shikimori", {
        id: "shikimori-anime",
        type: "anime",
        title: "Primary Anime",
        episodes: [{ episodeNumber: 1, title: "Primary Episode" }],
      }),
      providerDetailsResult("tmdb", {
        id: "tmdb-anime",
        type: "anime",
        title: "Secondary Anime",
        episodes: [{ episodeNumber: 1, title: "Secondary Episode" }],
      }),
    ],
    {},
  );

  assert.equal(details?.type, "anime");

  if (details === null || details.type !== "anime") {
    assert.fail("Expected anime details.");
  }

  assert.equal(details.episodes?.[0]?.title, "Primary Episode");
});

test("excludes details whose strong IDs conflict with the primary identity", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Conflict Movie",
        year: 2020,
        ids: { imdb: "tt-good" },
      }),
      providerDetailsResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Conflict Movie",
        year: 2021,
        ids: { imdb: "tt-conflict" },
        description: "Description from a different movie.",
        genres: [{ name: "Wrong genre" }],
      }),
    ],
    { warnings },
  );

  assert.equal(details?.year, 2020);
  assert.deepEqual(details?.ids, { imdb: "tt-good" });
  assert.equal(details?.description, undefined);
  assert.equal(details?.genres, undefined);
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["tmdb"],
  );
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging details; excluded tt-conflict.",
      provider: "imdb",
    },
  ]);
});

test("uses query strong IDs before provider priority when filtering details", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-wrong",
        type: "series",
        title: "Wrong Series",
        ids: { imdb: "tt-wrong" },
      }),
      providerDetailsResult("imdb", {
        id: "imdb-correct",
        type: "series",
        title: "Correct Series",
        ids: { imdb: "tt-correct" },
      }),
    ],
    { query: { ids: { imdb: "tt-correct" } }, warnings },
  );

  assert.equal(details?.id, "imdb-correct");
  assert.equal(details?.title, "Correct Series");
  assert.deepEqual(details?.ids, { imdb: "tt-correct" });
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging details; excluded tt-wrong.",
      provider: "tmdb",
    },
  ]);
});

test("keeps details that share a strong ID despite another ID conflict", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("kinobd", {
        id: "kinobd-naruto",
        type: "anime",
        title: "Наруто",
        ids: { imdb: "tt0409591", tmdb: "1062485", kinopoisk: "283290" },
      }),
      providerDetailsResult("cinemeta", {
        id: "cinemeta-naruto",
        type: "series",
        title: "Naruto",
        ids: { imdb: "tt0409591", tmdb: "46260" },
        episodesCount: 220,
      }),
    ],
    {
      query: {
        ids: { imdb: "tt0409591", tmdb: "1062485", kinopoisk: "283290" },
        type: "anime",
      },
      warnings,
    },
  );

  assert.equal(details?.type, "anime");
  assert.equal(details?.episodesCount, 220);
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["kinobd", "cinemeta"],
  );
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting tmdb IDs while merging details; kept 1062485.",
      provider: "cinemeta",
    },
  ]);
});
