import assert from "node:assert/strict";
import { test } from "node:test";

import type { EngineWarning } from "../response/index.js";
import { DefaultMergeStrategy } from "./strategy.js";
import { providerResult } from "./strategy.test-helpers.js";

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

test("selects localized search titles and descriptions when language is explicit", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "one-piece-en",
        type: "anime",
        title: "One Piece",
        year: 1999,
        description: "A much longer English description about pirates and adventure.",
        ids: { imdb: "tt0388629" },
      }),
      providerResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        year: 1999,
        description: "Русское описание приключений пиратов.",
        ids: { imdb: "tt0388629", shikimori: "21" },
      }),
    ],
    { query: { title: "one piece", language: "ru" }, language: "ru" },
  );

  assert.equal(search[0]?.item.title, "Ван-Пис");
  assert.equal(search[0]?.item.description, "Русское описание приключений пиратов.");
});

test("selects an English original title for an English query", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        year: 1999,
        ids: { shikimori: "21" },
      }),
    ],
    { query: { title: "one piece" }, language: "en" },
  );

  assert.equal(search[0]?.item.title, "One Piece");
  assert.deepEqual(search[0]?.item.alternativeTitles, ["Ван-Пис"]);
});

test("selects an exact English alias before a generic Latin-script title", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("anilist", {
        id: "spirited-away",
        type: "anime",
        title: "Sen to Chihiro no Kamikakushi",
        alternativeTitles: ["Spirited Away"],
        year: 2001,
        ids: { aniList: "199" },
      }),
    ],
    { query: { title: "spirited away" }, language: "en" },
  );

  assert.equal(search[0]?.item.title, "Spirited Away");
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

test("uses provider priority before title when equal scores come from different providers", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("shikimori", {
        id: "shikimori-game",
        type: "anime",
        title: "Anime Game",
        confidence: 1,
      }),
      providerResult("kinobd", {
        id: "kinobd-game",
        type: "movie",
        title: "Game Movie",
        confidence: 1,
      }),
    ],
    {},
  );

  assert.deepEqual(
    results.map((result) => result.sources[0]?.provider),
    ["kinobd", "shikimori"],
  );
});
