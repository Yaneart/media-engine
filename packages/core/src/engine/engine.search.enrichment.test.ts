import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("search bounds additional enrichment calls globally and per provider", async () => {
  const calls = new Map<string, number>();
  const sourceResults = Array.from({ length: 8 }, (_, index) => createSparseResult(index + 1));
  const enrichers = Array.from({ length: 4 }, (_, index) => {
    const name = `enricher-${index + 1}`;
    calls.set(name, 0);

    return createProvider({
      name,
      capabilities: {
        mediaTypes: ["movie"],
        search: { byTitle: false, byExternalIds: ["imdb"] },
        details: { byExternalIds: [] },
        features: ["ratings"],
      },
      async search(query): Promise<ProviderSearchResult[]> {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        const imdb = query.ids?.imdb;
        return imdb
          ? [
              {
                provider: name,
                item: {
                  id: `${name}:${imdb}`,
                  type: "movie",
                  title: "Movie",
                  ids: { imdb },
                  ratings: [{ source: "imdb", value: 8, max: 10 }],
                },
              },
            ]
          : [];
      },
    });
  });
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "catalog",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return sourceResults;
        },
      }),
      ...enrichers,
    ],
  });

  const response = await engine.search({ title: "Movie", limit: 8 });

  assert.equal(sumCalls(calls), 6);
  assert.deepEqual(Object.fromEntries(calls), {
    "enricher-1": 2,
    "enricher-2": 2,
    "enricher-3": 2,
    "enricher-4": 0,
  });
  assert.deepEqual(response.meta.debug?.enrichment?.id, {
    attempted: 6,
    skipped: 0,
    succeeded: 6,
    failed: 0,
  });
});

test("search enrichment considers only results inside a smaller public limit", async () => {
  let enrichmentCalls = 0;
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "catalog",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return Array.from({ length: 5 }, (_, index) => createSparseResult(index + 1));
        },
      }),
      createProvider({
        name: "enricher",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["ratings"],
        },
        async search(): Promise<ProviderSearchResult[]> {
          enrichmentCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Movie", limit: 1 });

  assert.equal(response.results.length, 1);
  assert.equal(enrichmentCalls, 1);
  assert.equal(response.meta.debug?.enrichment?.id.attempted, 1);
});

test("search skips ID providers that cannot improve the missing field", async () => {
  let posterOnlyCalls = 0;
  let ratingsCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "catalog",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "catalog",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                description: "Complete description.",
                poster: { url: "https://images.example/poster.jpg", type: "poster" },
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "poster-only",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["posters"],
        },
        async search(): Promise<ProviderSearchResult[]> {
          posterOnlyCalls += 1;
          return [];
        },
      }),
      createProvider({
        name: "ratings-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["ratings"],
        },
        async search(): Promise<ProviderSearchResult[]> {
          ratingsCalls += 1;
          return [];
        },
      }),
    ],
  });

  await engine.search({ title: "Interstellar", limit: 1 });

  assert.equal(posterOnlyCalls, 0);
  assert.equal(ratingsCalls, 1);
});

test("search reuses a matching ID enrichment result for the canonical poster", async () => {
  let idSearchCalls = 0;
  let detailsCalls = 0;
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "catalog",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [createSparseResult(1)];
        },
      }),
      createProvider({
        name: "canonical-source",
        searchPosterMatchesDetails: true,
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
          features: ["posters", "ratings"],
        },
        async search(query): Promise<ProviderSearchResult[]> {
          idSearchCalls += 1;
          return [
            {
              provider: "canonical-source",
              item: {
                id: "canonical-1",
                type: "movie",
                title: "Movie 1",
                description: "Enriched.",
                poster: { url: "https://images.example/canonical.jpg", type: "poster" },
                ratings: [{ source: "imdb", value: 8, max: 10 }],
                ids: query.ids,
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult | null> {
          detailsCalls += 1;
          return null;
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Movie 1", limit: 1 });

  assert.equal(idSearchCalls, 1);
  assert.equal(detailsCalls, 0);
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/canonical.jpg");
  assert.deepEqual(response.meta.debug?.enrichment, {
    id: { attempted: 1, skipped: 0, succeeded: 1, failed: 0 },
    poster: { attempted: 0, skipped: 1, succeeded: 0, failed: 0 },
  });
});

test("search optional enrichment stops at its wall-time budget", async () => {
  const engine = new MediaEngine({
    debug: true,
    timeoutMs: 5_000,
    providers: [
      createProvider({
        name: "catalog",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [createSparseResult(1)];
        },
      }),
      createProvider({
        name: "slow-enricher",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["ratings"],
        },
        async search(_query, context): Promise<ProviderSearchResult[]> {
          return new Promise((_, reject) => {
            context.signal?.addEventListener("abort", () => reject(context.signal?.reason), {
              once: true,
            });
          });
        },
      }),
    ],
  });
  const startedAt = Date.now();

  const response = await engine.search({ title: "Movie 1", limit: 1 });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs >= 1_000, `Expected bounded enrichment wait, received ${elapsedMs}ms.`);
  assert.ok(elapsedMs < 3_000, `Enrichment exceeded its wall-time budget: ${elapsedMs}ms.`);
  assert.deepEqual(response.meta.debug?.enrichment?.id, {
    attempted: 1,
    skipped: 0,
    succeeded: 0,
    failed: 1,
  });
});

function createSparseResult(index: number): ProviderSearchResult {
  return {
    provider: "catalog",
    item: {
      id: `movie-${index}`,
      type: "movie",
      title: `Movie ${index}`,
      ids: { imdb: `tt${String(index).padStart(7, "0")}` },
    },
  };
}

function sumCalls(calls: Map<string, number>): number {
  return Array.from(calls.values()).reduce((total, value) => total + value, 0);
}
