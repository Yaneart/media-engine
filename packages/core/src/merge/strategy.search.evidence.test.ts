import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaType } from "../media/index.js";
import { DefaultMergeStrategy } from "./strategy.js";
import { providerResult } from "./strategy.test-helpers.js";

const strategy = new DefaultMergeStrategy();

test("exposes ranking factor values, weights, and contributions only in debug mode", () => {
  const providerResults = [
    providerResult("cinemeta", {
      id: "dune-cinemeta",
      type: "movie",
      title: "Dune",
      year: 2021,
      ids: { imdb: "tt1160419" },
      ratings: [{ source: "imdb", value: 8, max: 10, votes: 900_000 }],
      confidence: 0.95,
    }),
    providerResult("wikidata", {
      id: "dune-wikidata",
      type: "movie",
      title: "Dune",
      year: 2021,
      ids: { imdb: "tt1160419" },
      confidence: 0.8,
    }),
  ];

  const regular = strategy.mergeSearchResults(providerResults, {
    query: { title: "dune" },
  });
  const debug = strategy.mergeSearchResults(providerResults, {
    query: { title: "dune" },
    debug: true,
  });
  const ranking = debug[0]?.ranking;

  assert.equal(regular[0]?.ranking, undefined);
  assert.equal(ranking?.formula, "text");
  assert.equal(ranking?.matchStrength, "exact_id");
  assert.deepEqual(ranking?.titleMatch, {
    kind: "exact_primary",
    score: 1,
    matchedTitle: "Dune",
  });
  assert.deepEqual(ranking?.signals.title, {
    value: 1,
    weight: 0.2,
    contribution: 0.2,
  });
  assert.deepEqual(ranking?.signals.exactPrimaryTitle, {
    value: 1,
    weight: 0.3,
    contribution: 0.3,
  });
  assert.equal(
    ranking?.preBoundedScore,
    Object.values(ranking?.signals ?? {}).reduce(
      (total, rankingSignal) => total + rankingSignal.contribution,
      0,
    ),
  );
  assert.deepEqual(
    {
      scorePosition: ranking?.scorePosition,
      diversityPosition: ranking?.diversityPosition,
      finalPosition: ranking?.finalPosition,
      adjusted: ranking?.diversity.adjusted,
    },
    { scorePosition: 1, diversityPosition: 1, finalPosition: 1, adjusted: false },
  );
});

test("interleaves a comparable media type after two results from one title family", () => {
  const results = strategy.mergeSearchResults(
    [
      exactEcho("movie-2020", "movie", 2020),
      exactEcho("movie-2021", "movie", 2021),
      exactEcho("movie-2022", "movie", 2022),
      exactEcho("series-2023", "series", 2023),
    ],
    { query: { title: "echo" }, debug: true },
  );

  assert.deepEqual(
    results.map((result) => result.item.id),
    ["movie-2020", "movie-2021", "series-2023", "movie-2022"],
  );
  assert.deepEqual(
    results.map((result) => ({
      id: result.item.id,
      score: result.ranking?.scorePosition,
      diversity: result.ranking?.diversityPosition,
      adjusted: result.ranking?.diversity.adjusted,
    })),
    [
      { id: "movie-2020", score: 1, diversity: 1, adjusted: false },
      { id: "movie-2021", score: 2, diversity: 2, adjusted: false },
      { id: "series-2023", score: 4, diversity: 3, adjusted: true },
      { id: "movie-2022", score: 3, diversity: 4, adjusted: true },
    ],
  );
  assert.deepEqual(
    results.map((result) => result.ranking?.diversity.family),
    ["movie:echo", "movie:echo", "series:echo", "movie:echo"],
  );
});

test("does not promote a materially weaker title merely to add diversity", () => {
  const results = strategy.mergeSearchResults(
    [
      exactEcho("movie-2020", "movie", 2020),
      exactEcho("movie-2021", "movie", 2021),
      exactEcho("movie-2022", "movie", 2022),
      providerResult("catalog", {
        id: "echo-legacy",
        type: "series",
        title: "Echo Legacy",
        year: 2023,
        confidence: 0.1,
      }),
    ],
    { query: { title: "echo" }, debug: true },
  );

  assert.deepEqual(
    results.map((result) => result.item.id),
    ["movie-2020", "movie-2021", "movie-2022", "echo-legacy"],
  );
  assert.ok(results.every((result) => result.ranking?.diversity.adjusted === false));
});

function exactEcho(id: string, type: MediaType, year: number) {
  return providerResult("catalog", {
    id,
    type,
    title: "Echo",
    year,
    ids: { imdb: `tt-${id}` },
    confidence: 0.8,
  });
}
