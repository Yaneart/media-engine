import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache, type Cache } from "../cache/index.js";
import { MediaEngineError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import type { SearchQuery } from "../search/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("search rejects empty queries predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.search({}), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Search query must include title or external ids.",
  });
});

test("search rejects limits that could amplify provider and merge work", async () => {
  const engine = new MediaEngine();

  await assert.rejects(
    engine.search({ title: "Interstellar", limit: 101 }),
    (error: unknown) =>
      error instanceof MediaEngineError &&
      error.code === "INVALID_QUERY" &&
      error.message.includes("between 0 and 100"),
  );
});

test("search normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedIds = query.ids;
          return [
            {
              provider: "imdb-provider",
              item: {
                id: "imdb-tt0816692",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ imdb: "tt0816692" });

  assert.deepEqual(receivedIds, { imdb: "tt0816692" });
  assert.deepEqual(response.query.ids, { imdb: "tt0816692" });
  assert.equal(response.results.length, 1);
});

test("search canonicalizes equivalent shortcut and nested ID queries into one cache key", async () => {
  let calls = 0;
  let receivedQuery: unknown;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          calls += 1;
          receivedQuery = query;
          return [
            {
              provider: "test-provider",
              item: { id: "movie-1", type: "movie", title: "Interstellar" },
            },
          ];
        },
      }),
    ],
  });

  const first = await engine.search({
    title: "  Interstellar  ",
    ids: { imdb: "tt0000001", tmdb: " 157336 " },
    imdb: " TT0816692 ",
    language: " EN-US ",
    limit: 2,
  });
  const second = await engine.search({
    title: "Interstellar",
    ids: { tmdb: "157336", imdb: "tt0816692" },
    language: "en-us",
    limit: 2,
  });

  assert.deepEqual(receivedQuery, {
    title: "Interstellar",
    ids: { imdb: "tt0816692", tmdb: "157336" },
    limit: 10,
    language: "en-us",
  });
  assert.deepEqual(first.query, {
    title: "Interstellar",
    ids: { imdb: "tt0816692", tmdb: "157336" },
    limit: 2,
    language: "en-us",
  });
  assert.deepEqual(second.query, first.query);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(calls, 1);
});

test("search returns limit zero before provider, enrichment, or cache work", async () => {
  let providerCalls = 0;
  let cacheCalls = 0;
  const cache: Cache = {
    get() {
      cacheCalls += 1;
      return undefined;
    },
    getStale() {
      cacheCalls += 1;
      return undefined;
    },
    set() {
      cacheCalls += 1;
    },
    delete() {},
    clear() {},
  };
  const engine = new MediaEngine({
    cache,
    debug: true,
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          providerCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: " Interstellar ", limit: 0 });

  assert.deepEqual(response.query, { title: "Interstellar", limit: 0 });
  assert.deepEqual(response.results, []);
  assert.deepEqual(response.meta.providers, { requested: [], successful: [], failed: [] });
  assert.equal(response.meta.cached, false);
  assert.deepEqual(response.meta.debug, { providers: [], timings: [], enrichment: undefined });
  assert.equal(providerCalls, 0);
  assert.equal(cacheCalls, 0);
});

test("search rejects malformed or oversized canonical fields before provider selection", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          return [];
        },
      }),
    ],
  });
  const invalidQueries: SearchQuery[] = [
    { title: "x".repeat(301) },
    { title: "Interstellar", language: "x".repeat(36) },
    { title: "Inter\nstellar" },
    { imdb: "0816692" },
    { tmdb: "movie-157336" },
    { title: "Interstellar", year: -1 },
    { title: "Interstellar", type: "book" as SearchQuery["type"] },
  ];

  for (const query of invalidQueries) {
    await assert.rejects(
      engine.search(query),
      (error: unknown) => error instanceof MediaEngineError && error.code === "INVALID_QUERY",
    );
  }

  assert.equal(calls, 0);
});

test("search infers provider context language from the title script", async () => {
  const receivedLanguages: Array<string | undefined> = [];
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(_query, context): Promise<ProviderSearchResult[]> {
          receivedLanguages.push(context.language);
          return [];
        },
      }),
    ],
  });

  await engine.search({ title: "интерстеллар" });
  await engine.search({ title: "Interstellar" });
  await engine.search({ title: "進撃の巨人" });

  assert.deepEqual(receivedLanguages, ["ru", "en", "ja"]);
});

test("search widens provider limit before applying public response limit", async () => {
  let receivedLimit: number | undefined;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedLimit = query.limit;
          return [
            {
              provider: "test-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Weak Result",
              },
              confidence: 0.2,
            },
            {
              provider: "test-provider",
              item: {
                id: "movie-2",
                type: "movie",
                title: "Interstellar",
              },
              confidence: 0.9,
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar", limit: 1 });

  assert.equal(receivedLimit, 10);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.item.title, "Interstellar");
});

test("search widens short broad title queries more aggressively", async () => {
  let receivedLimit: number | undefined;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedLimit = query.limit;
          return [];
        },
      }),
    ],
  });

  await engine.search({ title: "one", limit: 5 });

  assert.equal(receivedLimit, 50);
});
