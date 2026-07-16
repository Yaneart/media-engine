import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { MediaDetails } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider, sleep } from "./test-helpers.js";

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

test("search tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "failing-provider",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Provider is unavailable.",
          });
        },
      }),
      createProvider({
        name: "successful-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "successful-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(response.results.length, 1);
  assert.deepEqual(response.meta.providers.requested, ["failing-provider", "successful-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["successful-provider"]);
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "failing-provider",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Provider is unavailable.",
    },
  ]);
});

test("search enriches sparse top results through one external ID provider", async () => {
  let enrichmentQueries = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "title-source",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          if (!query.title) {
            return [];
          }

          return [
            {
              provider: "title-source",
              item: {
                id: "imdb:tt0388629",
                type: "series",
                title: "One Piece",
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "id-enricher",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
          features: ["ratings", "alternative_titles"],
        },
        async search(query): Promise<ProviderSearchResult[]> {
          enrichmentQueries += 1;
          assert.deepEqual(query.ids, { imdb: "tt0388629" });
          assert.equal(query.limit, 1);

          return [
            {
              provider: "id-enricher",
              item: {
                id: "kinopoisk:382731",
                type: "series",
                title: "Ван-Пис",
                alternativeTitles: ["One Piece"],
                ids: { imdb: "tt0388629", kinopoisk: "382731" },
                ratings: [{ source: "kinopoisk", value: 8.5, max: 10 }],
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "ванпис", limit: 10 });

  assert.equal(enrichmentQueries, 1);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.item.ids?.kinopoisk, "382731");
  assert.equal(response.results[0]?.item.ratings?.[0]?.value, 8.5);
  assert.deepEqual(
    response.results[0]?.sources.map((source) => source.provider),
    ["title-source", "id-enricher"],
  );
});

test("search uses the canonical details poster before returning results", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "poster-provider",
        capabilities: {
          mediaTypes: ["anime"],
          search: { byTitle: true, byExternalIds: ["shikimori"] },
          details: { byExternalIds: ["shikimori"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "poster-provider",
              item: {
                id: "anime:21",
                type: "anime",
                title: "One Piece",
                poster: { url: "https://images.example/search.jpg", type: "poster" },
                ids: { shikimori: "21" },
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          return {
            provider: "poster-provider",
            details: {
              id: "anime:21",
              type: "anime",
              title: "One Piece",
              poster: { url: "https://images.example/details.jpg", type: "poster" },
              ids: { shikimori: "21" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one", limit: 1 });

  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/details.jpg");
});

test("search runs ID and poster enrichment concurrently", async () => {
  let resolveIdEnrichment: ((results: ProviderSearchResult[]) => void) | undefined;
  let resolvePosterEnrichment: ((result: ProviderDetailsResult) => void) | undefined;
  let markIdEnrichmentStarted: (() => void) | undefined;
  let markPosterEnrichmentStarted: (() => void) | undefined;
  const idEnrichmentStarted = new Promise<void>((resolve) => {
    markIdEnrichmentStarted = resolve;
  });
  const posterEnrichmentStarted = new Promise<void>((resolve) => {
    markPosterEnrichmentStarted = resolve;
  });
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "title-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "title-source",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "id-enricher",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          markIdEnrichmentStarted?.();
          return new Promise((resolve) => {
            resolveIdEnrichment = resolve;
          });
        },
      }),
      createProvider({
        name: "poster-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: [] },
          details: { byExternalIds: ["imdb"] },
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          markPosterEnrichmentStarted?.();
          return new Promise((resolve) => {
            resolvePosterEnrichment = resolve;
          });
        },
      }),
    ],
  });

  const searchPromise = engine.search({ title: "Interstellar" });
  const bothStarted = await Promise.race([
    Promise.all([idEnrichmentStarted, posterEnrichmentStarted]).then(() => true),
    sleep(20).then(() => false),
  ]);

  assert.equal(bothStarted, true);
  resolveIdEnrichment?.([
    {
      provider: "id-enricher",
      item: {
        id: "movie-1-enriched",
        type: "movie",
        title: "Interstellar",
        description: "Enriched description.",
        ids: { imdb: "tt0816692" },
      },
    },
  ]);
  resolvePosterEnrichment?.({
    provider: "poster-provider",
    details: {
      id: "movie-1-details",
      type: "movie",
      title: "Interstellar",
      poster: { url: "https://images.example/poster.jpg", type: "poster" },
      ids: { imdb: "tt0816692" },
    },
  });

  const response = await searchPromise;

  assert.equal(response.results[0]?.item.description, "Enriched description.");
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/poster.jpg");
});

test("search does not retry a failed search provider for poster enrichment", async () => {
  let failedProviderDetailsCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failed-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "failed-provider",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            message: "Provider timed out.",
          });
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          failedProviderDetailsCalls += 1;
          throw new Error("Failed search provider must not be retried for a poster.");
        },
      }),
      createProvider({
        name: "successful-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "successful-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1-details",
              type: "movie",
              title: "Interstellar",
              poster: { url: "https://images.example/poster.jpg", type: "poster" },
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(failedProviderDetailsCalls, 0);
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/poster.jpg");
});

test("search enriches incomplete anime cards through a compatible series catalog", async () => {
  let receivedType: string | undefined = "not-called";
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "anime-source",
        capabilities: {
          mediaTypes: ["anime"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          if (!query.title) return [];
          return [
            {
              provider: "anime-source",
              item: {
                id: "anime:21",
                type: "anime",
                title: "Ван-Пис",
                originalTitle: "One Piece",
                year: 1999,
                poster: { url: "https://images.example/old.jpg", type: "poster" },
                ratings: [{ source: "shikimori", value: 8.7, max: 10 }],
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "kinobd",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          receivedType = query.type;
          return [
            {
              provider: "kinobd",
              item: {
                id: "series:tt0388629",
                type: "series",
                title: "One Piece",
                year: 1999,
                description: "Complete catalog synopsis.",
                poster: { url: "https://images.example/current.jpg", type: "poster" },
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one", limit: 1 });

  assert.equal(receivedType, undefined);
  assert.equal(response.results[0]?.item.type, "anime");
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/current.jpg");
  assert.equal(response.results[0]?.item.description, "Complete catalog synopsis.");
});

test("search starts independent providers concurrently", async () => {
  let resolveSlowProvider: ((results: ProviderSearchResult[]) => void) | undefined;
  let markFastProviderStarted: (() => void) | undefined;
  const fastProviderStarted = new Promise<void>((resolve) => {
    markFastProviderStarted = resolve;
  });
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "slow-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return new Promise((resolve) => {
            resolveSlowProvider = resolve;
          });
        },
      }),
      createProvider({
        name: "fast-provider",
        async search(): Promise<ProviderSearchResult[]> {
          markFastProviderStarted?.();

          return [
            {
              provider: "fast-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
              },
            },
          ];
        },
      }),
    ],
  });

  const searchPromise = engine.search({ title: "Interstellar" });
  const fastStartedBeforeSlowFinished = await Promise.race([
    fastProviderStarted.then(() => true),
    sleep(20).then(() => false),
  ]);

  resolveSlowProvider?.([]);

  assert.equal(fastStartedBeforeSlowFinished, true);

  const response = await searchPromise;

  assert.deepEqual(response.meta.providers.successful, ["slow-provider", "fast-provider"]);
  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "slow-provider",
        status: "success",
        tookMsType: "number",
      },
      {
        provider: "fast-provider",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("search keeps provider result order deterministic after concurrent completion", async () => {
  const receivedProviders: string[] = [];
  const mergeStrategy: MergeStrategy = {
    mergeSearchResults(results): MediaSearchResult[] {
      receivedProviders.push(...results.map((result) => result.provider));

      return results.map((result) => ({
        item: result.item,
        score: result.confidence ?? 0,
        sources: [{ provider: result.provider, id: result.item.id }],
      }));
    },
    mergeDetails(): MediaDetails | null {
      return null;
    },
  };
  const engine = new MediaEngine({
    mergeStrategy,
    providers: [
      createProvider({
        name: "slow-provider",
        async search(): Promise<ProviderSearchResult[]> {
          await sleep(20);

          return [
            {
              provider: "slow-provider",
              item: {
                id: "movie-slow",
                type: "movie",
                title: "Slow Result",
              },
            },
          ];
        },
      }),
      createProvider({
        name: "fast-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "fast-provider",
              item: {
                id: "movie-fast",
                type: "movie",
                title: "Fast Result",
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.deepEqual(receivedProviders, ["slow-provider", "fast-provider"]);
  assert.deepEqual(
    response.results.map((result) => result.item.title),
    ["Slow Result", "Fast Result"],
  );
});

test("search throws predictably when all selected providers fail", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async search(): Promise<ProviderSearchResult[]> {
          throw new Error("Network failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.search({ title: "Interstellar" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All search providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-provider",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Network failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("search retries transient failures when every selected provider fails together", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "transient-provider",
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;

          if (calls === 1) {
            throw new ProviderError({
              provider: "transient-provider",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Temporary timeout.",
            });
          }

          return [
            {
              provider: "transient-provider",
              item: { id: "one-piece", type: "anime", title: "One Piece" },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one piece" });

  assert.equal(calls, 2);
  assert.equal(response.results[0]?.item.title, "One Piece");
  assert.deepEqual(response.meta.providers.failed, []);
});

test("search broadens an empty multi-word typo and ranks against the original query", async () => {
  const receivedTitles: string[] = [];
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedTitles.push(query.title ?? "");

          return query.title === "game of"
            ? [
                {
                  provider: "test-provider",
                  item: {
                    id: "game-of-thrones",
                    type: "series",
                    title: "Game of Thrones",
                  },
                },
              ]
            : [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "game of throen" });

  assert.deepEqual(receivedTitles, ["game of throen", "game of"]);
  assert.equal(response.results[0]?.item.title, "Game of Thrones");
});

test("search separates an empty joined compound title and ranks against the original query", async () => {
  const receivedTitles: string[] = [];
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "joined-title-provider",
        async search(query): Promise<ProviderSearchResult[]> {
          receivedTitles.push(query.title ?? "");

          return query.title === "ван пис"
            ? [
                {
                  provider: "joined-title-provider",
                  item: {
                    id: "one-piece",
                    type: "anime",
                    title: "Ван-Пис",
                    year: 1999,
                  },
                },
                {
                  provider: "joined-title-provider",
                  item: {
                    id: "unrelated",
                    type: "movie",
                    title: "Ван Хельсинг",
                    year: 2004,
                  },
                },
              ]
            : [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "ванпис", limit: 10 });

  assert.deepEqual(receivedTitles, ["ванпис", "ван пис"]);
  assert.deepEqual(
    response.results.map((result) => result.item.title),
    ["Ван-Пис"],
  );
});

test("search returns empty response when no providers are available", async () => {
  const engine = new MediaEngine();
  const response = await engine.search({ title: "Interstellar" });

  assert.deepEqual(response.results, []);
  assert.deepEqual(response.meta.providers, {
    requested: [],
    successful: [],
    failed: [],
  });
  assert.equal(response.meta.cached, false);
  assert.equal(typeof response.meta.tookMs, "number");
});

test("search applies timeout to providers that do not finish", async () => {
  const engine = new MediaEngine({
    timeoutMs: 1,
    providers: [
      createProvider({
        name: "slow-provider",
        async search(): Promise<ProviderSearchResult[]> {
          await new Promise(() => undefined);
          return [];
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.search({ title: "Interstellar" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.deepEqual((error as Error & { cause?: { failed: unknown[] } }).cause?.failed, [
        {
          provider: "slow-provider",
          code: "PROVIDER_TIMEOUT",
          retryable: true,
          message: 'Provider "slow-provider" timed out.',
        },
      ]);
      return true;
    },
  );
});

test("search cache integration keeps response shape", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          return [
            {
              provider: "test-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
              },
            },
          ];
        },
      }),
    ],
  });

  const first = await engine.search({ title: "Interstellar" });
  const second = await engine.search({ title: "Interstellar" });

  assert.equal(calls, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.deepEqual(Object.keys(first).sort(), ["meta", "query", "results"]);
  assert.deepEqual(Object.keys(second).sort(), ["meta", "query", "results"]);
  assert.deepEqual(second.results, first.results);
});
