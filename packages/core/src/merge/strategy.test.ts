import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaDetails, MediaItem } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning } from "../response/index.js";
import { DefaultMergeStrategy } from "./strategy.js";

const strategy = new DefaultMergeStrategy();

test("merges exact external ID matches into one search result", () => {
  const warnings: EngineWarning[] = [];
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "Interstellar",
        year: 2014,
        ids: { tmdb: "157336", imdb: "tt0816692" },
        genres: [{ name: "Science Fiction" }],
        ratings: [{ source: "tmdb", value: 8.4, max: 10 }],
      }),
      providerResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "Interstellar",
        originalTitle: "Interstellar",
        alternativeTitles: ["Interstellar 2014"],
        year: 2014,
        ids: { imdb: "tt0816692" },
        genres: [{ name: "Sci-Fi" }],
        ratings: [{ source: "imdb", value: 8.7, max: 10 }],
      }),
    ],
    { warnings },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 1);
  assert.deepEqual(results[0]?.item.ids, { tmdb: "157336", imdb: "tt0816692" });
  assert.deepEqual(
    results[0]?.item.ratings?.map((rating) => rating.source),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(
    results[0]?.sources.map((source) => source.provider),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(warnings, []);
});

test("warns on conflicting strong IDs without overwriting provider priority value", () => {
  const warnings: EngineWarning[] = [];
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Shared Movie",
        year: 2020,
        ids: { tmdb: "1", imdb: "tt-good" },
      }),
      providerResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Shared Movie",
        year: 2020,
        ids: { tmdb: "1", imdb: "tt-conflict" },
      }),
    ],
    { warnings },
  );

  assert.equal(results.length, 1);
  assert.deepEqual(results[0]?.item.ids, { tmdb: "1", imdb: "tt-good" });
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging search results; kept tt-good.",
      provider: "imdb",
    },
  ]);
});

test("does not auto-merge weak title matches", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-fma",
        type: "anime",
        title: "Fullmetal Alchemist",
        year: 2003,
      }),
      providerResult("shikimori", {
        id: "shikimori-fma-brotherhood",
        type: "anime",
        title: "Fullmetal Alchemist: Brotherhood",
        year: 2009,
      }),
    ],
    {},
  );

  assert.equal(results.length, 2);
});

test("merges normalized title year type matches without fuzzy matching", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Spider-Man",
        year: 2002,
      }),
      providerResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Spider Man",
        year: 2002,
      }),
    ],
    {},
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 0.8);
});

test("keeps deterministic output order for equal scores", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("custom", {
        id: "b",
        type: "movie",
        title: "Beta",
        confidence: undefined,
      }),
      providerResult("custom", {
        id: "a",
        type: "movie",
        title: "Alpha",
        confidence: undefined,
      }),
    ],
    {},
  );

  assert.deepEqual(
    results.map((result) => result.item.title),
    ["Alpha", "Beta"],
  );
});

test("does not merge normalized title matches when strong IDs conflict", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Duplicate Title",
        year: 2021,
        ids: { imdb: "tt-one" },
      }),
      providerResult("imdb", {
        id: "imdb-2",
        type: "movie",
        title: "Duplicate Title",
        year: 2021,
        ids: { imdb: "tt-two" },
      }),
    ],
    {},
  );

  assert.equal(results.length, 2);
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

  if (details?.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(details.persons?.[0]?.person.name, "Primary Actor");
  assert.equal(details.seasons?.[0]?.title, "Primary Season");
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

  if (details?.type !== "anime") {
    assert.fail("Expected anime details.");
  }

  assert.equal(details.episodes?.[0]?.title, "Primary Episode");
});

test("warns on details conflicts without overwriting provider priority values", () => {
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
      }),
    ],
    { warnings },
  );

  assert.equal(details?.year, 2020);
  assert.deepEqual(details?.ids, { imdb: "tt-good" });
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging details; kept tt-good.",
      provider: "imdb",
    },
    {
      code: "YEAR_CONFLICT",
      message: "Conflicting years while merging details; kept 2020.",
      provider: "imdb",
    },
  ]);
});

function providerResult(
  provider: string,
  item: MediaItem & { confidence?: number },
): ProviderSearchResult {
  const { confidence, ...mediaItem } = item;

  return {
    provider,
    item: mediaItem,
    confidence,
  };
}

function providerDetailsResult(provider: string, details: MediaDetails): ProviderDetailsResult {
  return {
    provider,
    details,
  };
}
