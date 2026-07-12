import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { MediaDetails } from "../media/index.js";
import type { MergeContext, MergeStrategy } from "../merge/index.js";
import type {
  MediaProvider,
  ProviderDetailsResult,
  ProviderSearchResult,
} from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import type { MediaAvailability, StreamQuery, StreamingProvider } from "../streaming/index.js";
import { MediaEngine } from "./engine.js";

test("constructs with no providers", () => {
  const engine = new MediaEngine();

  assert.deepEqual(engine.getProviders(), []);
});

test("constructs with mock providers and returns safe provider info", () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "secret-provider",
        version: "1.0.0",
        apiKey: "secret-api-key",
      }),
    ],
  });

  assert.deepEqual(engine.getProviders(), [
    {
      name: "secret-provider",
      version: "1.0.0",
      kind: "metadata",
      capabilities: {
        mediaTypes: ["movie"],
        search: {
          byTitle: true,
          byExternalIds: ["imdb"],
        },
        details: {
          byExternalIds: ["imdb"],
        },
        features: undefined,
      },
    },
  ]);
  assert.equal("apiKey" in engine.getProviders()[0]!, false);
});

test("passes providers through the registry duplicate-name validation", () => {
  assert.throws(
    () =>
      new MediaEngine({
        providers: [createProvider({ name: "tmdb" }), createProvider({ name: "tmdb" })],
      }),
    /already registered/,
  );
});

test("passes streaming providers through duplicate-name validation", () => {
  assert.throws(
    () =>
      new MediaEngine({
        streamingProviders: [
          createStreamingProvider({ name: "kodik" }),
          createStreamingProvider({ name: "kodik" }),
        ],
      }),
    /already registered/,
  );
});

test("rejects blank or padded streaming provider names", () => {
  assert.throws(
    () =>
      new MediaEngine({
        streamingProviders: [createStreamingProvider({ name: " " })],
      }),
    /name is required/,
  );
  assert.throws(
    () =>
      new MediaEngine({
        streamingProviders: [createStreamingProvider({ name: " kodik" })],
      }),
    /must not include/,
  );
});

test("accepts custom cache merge strategy timeout and debug options", () => {
  const cache = new MemoryCache();
  const mergeStrategy: MergeStrategy = {
    mergeSearchResults(): MediaSearchResult[] {
      return [];
    },
    mergeDetails(): MediaDetails | null {
      return null;
    },
  };

  assert.doesNotThrow(
    () =>
      new MediaEngine({
        cache,
        mergeStrategy,
        timeoutMs: 1_000,
        debug: true,
      }),
  );
});

test("returns safe streaming provider info", () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "streaming-secret-provider",
        version: "1.0.0",
        secret: "hidden",
      }),
    ],
  });

  assert.deepEqual(engine.getStreamingProviders(), [
    {
      name: "streaming-secret-provider",
      version: "1.0.0",
      kind: "streaming",
      capabilities: {
        mediaTypes: ["anime"],
        lookup: {
          byTitle: true,
          byExternalIds: ["shikimori"],
          byEpisode: true,
        },
        features: ["embed", "translations", "qualities", "episode_mapping"],
      },
    },
  ]);
  assert.equal("secret" in engine.getStreamingProviders()[0]!, false);

  const providerInfo = engine.getStreamingProviders()[0]!;
  providerInfo.capabilities.mediaTypes.push("movie");
  providerInfo.capabilities.lookup.byExternalIds.push("imdb");
  providerInfo.capabilities.features?.push("hls");

  assert.deepEqual(engine.getStreamingProviders()[0]?.capabilities, {
    mediaTypes: ["anime"],
    lookup: {
      byTitle: true,
      byExternalIds: ["shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  });
});

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

test("getDetails rejects empty queries predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.getDetails({}), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Details query must include id or external ids.",
  });
});

test("getDetails normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async getDetails(query): Promise<ProviderDetailsResult | null> {
          receivedIds = query.ids;
          return {
            provider: "test-provider",
            details: {
              id: "imdb-tt0816692",
              type: "movie",
              title: "Interstellar",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(receivedIds, { imdb: "tt0816692" });
  assert.deepEqual(response.query.ids, { imdb: "tt0816692" });
  assert.equal(response.details?.title, "Interstellar");
});

test("getDetails skips providers without getDetails", async () => {
  const searchOnlyProvider = createProvider({
    name: "search-only-provider",
    getDetails: undefined,
  });
  const detailsProvider = createProvider({
    name: "details-provider",
    async getDetails(): Promise<ProviderDetailsResult | null> {
      return {
        provider: "details-provider",
        details: {
          id: "movie-1",
          type: "movie",
          title: "Interstellar",
        },
      };
    },
  });
  const engine = new MediaEngine({
    providers: [searchOnlyProvider, detailsProvider],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(response.meta.providers.requested, ["details-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["details-provider"]);
  assert.equal(response.details?.title, "Interstellar");
});

test("getDetails tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new ProviderError({
            provider: "failing-provider",
            code: "PROVIDER_RATE_LIMITED",
            retryable: true,
            message: "Rate limited.",
          });
        },
      }),
      createProvider({
        name: "successful-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details?.title, "Interstellar");
  assert.deepEqual(response.meta.providers.requested, ["failing-provider", "successful-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["successful-provider"]);
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "failing-provider",
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      message: "Rate limited.",
    },
  ]);
});

test("getDetails includes provider timings when debug is enabled", async () => {
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new Error("Details failed.");
        },
      }),
      createProvider({
        name: "successful-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "failing-provider",
        status: "failed",
        tookMsType: "number",
      },
      {
        provider: "successful-provider",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("getDetails calls selected providers concurrently", async () => {
  const calls: string[] = [];
  let releaseFirstProvider: (() => void) | undefined;
  const firstProviderGate = new Promise<void>((resolve) => {
    releaseFirstProvider = resolve;
  });

  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "slow-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls.push("slow-start");
          await firstProviderGate;
          calls.push("slow-finish");

          return {
            provider: "slow-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Slow Details",
            },
          };
        },
      }),
      createProvider({
        name: "fast-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls.push("fast-start");
          releaseFirstProvider?.();
          calls.push("fast-finish");

          return {
            provider: "fast-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Fast Details",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details?.title, "Slow Details");
  assert.deepEqual(calls, ["slow-start", "fast-start", "fast-finish", "slow-finish"]);
});

test("getDetails applies provider timeout overrides within the global boundary", async () => {
  let slowTimeoutMs: number | undefined;
  let fastTimeoutMs: number | undefined;
  const engine = new MediaEngine({
    timeoutMs: 100,
    providerTimeouts: {
      "slow-provider": 5,
      "fast-provider": 500,
    },
    providers: [
      createProvider({
        name: "slow-provider",
        async getDetails(_, context): Promise<ProviderDetailsResult | null> {
          slowTimeoutMs = context.timeoutMs;
          await new Promise((resolve) => setTimeout(resolve, 50));

          return null;
        },
      }),
      createProvider({
        name: "fast-provider",
        async getDetails(_, context): Promise<ProviderDetailsResult | null> {
          fastTimeoutMs = context.timeoutMs;

          return {
            provider: "fast-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Fast Details",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(slowTimeoutMs, 5);
  assert.equal(fastTimeoutMs, 100);
  assert.equal(response.details?.title, "Fast Details");
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "slow-provider",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      message: 'Provider "slow-provider" timed out.',
    },
  ]);
});

test("getDetails throws predictably when all selected providers fail", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new Error("Details failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getDetails({ imdb: "tt0816692" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All details providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-provider",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Details failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("getDetails returns null details when providers return no details", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "empty-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return null;
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details, null);
  assert.deepEqual(response.meta.providers.requested, ["empty-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["empty-provider"]);
  assert.deepEqual(response.meta.providers.failed, []);
});

test("getDetails cache integration keeps response shape", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls += 1;
          return {
            provider: "test-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const first = await engine.getDetails({ imdb: "tt0816692" });
  const second = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(calls, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.deepEqual(Object.keys(first).sort(), ["details", "meta", "query"]);
  assert.deepEqual(Object.keys(second).sort(), ["details", "meta", "query"]);
  assert.deepEqual(second.details, first.details);
});

test("getAvailability rejects empty identity predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.getAvailability({ type: "anime" }), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Stream query must include title or external ids.",
  });
});

test("getAvailability normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability | null> {
          receivedIds = query.ids;
          return createAvailability(query, "shortcut-provider");
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    shikimori: "20",
    absoluteEpisodeNumber: 1,
  });

  assert.deepEqual(receivedIds, { shikimori: "20" });
  assert.deepEqual(availability.query.ids, { shikimori: "20" });
  assert.equal(availability.options.length, 1);
});

test("getAvailability returns empty availability when no streaming providers are available", async () => {
  const engine = new MediaEngine();
  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(availability.query, { type: "anime", title: "Naruto" });
  assert.deepEqual(availability.options, []);
  assert.deepEqual(availability.sourceProviders, []);
  assert.deepEqual(availability.meta?.providers, {
    requested: [],
    successful: [],
    failed: [],
  });
  assert.equal(typeof availability.checkedAt, "string");
});

test("getAvailability merges multiple streaming provider results", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({ name: "kodik" }),
      createStreamingProvider({ name: "mirror" }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    absoluteEpisodeNumber: 1,
  });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(
    availability.episodes?.[0]?.options.map((option) => option.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(
    availability.sourceProviders.map((source) => source.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(availability.meta?.providers.requested, ["kodik", "mirror"]);
  assert.deepEqual(availability.meta?.providers.successful, ["kodik", "mirror"]);
  assert.deepEqual(availability.meta?.providers.failed, []);
});

test("getAvailability derives episode groups from top-level episode options", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "top-level-stream",
        async getAvailability(query): Promise<MediaAvailability | null> {
          const availability = createAvailability(query, "top-level-stream");

          return {
            ...availability,
            episodes: undefined,
          };
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    absoluteEpisodeNumber: 1,
  });

  assert.equal(availability.episodes?.length, 1);
  assert.equal(availability.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.deepEqual(availability.episodes?.[0]?.options, availability.options);
});

test("getAvailability respects requested streaming provider filter", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({ name: "kodik" }),
      createStreamingProvider({ name: "mirror" }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    providers: ["mirror"],
  });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["mirror"],
  );
});

test("getAvailability tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new ProviderError({
            provider: "failing-stream",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Streaming provider is unavailable.",
          });
        },
      }),
      createStreamingProvider({ name: "successful-stream" }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["successful-stream"],
  );
  assert.deepEqual(availability.meta?.providers.requested, ["failing-stream", "successful-stream"]);
  assert.deepEqual(availability.meta?.providers.successful, ["successful-stream"]);
  assert.deepEqual(availability.meta?.providers.failed, [
    {
      provider: "failing-stream",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Streaming provider is unavailable.",
    },
  ]);
});

test("getAvailability starts independent streaming providers concurrently", async () => {
  let resolveSlowProvider: ((availability: MediaAvailability) => void) | undefined;
  let markFastProviderStarted: (() => void) | undefined;
  const fastProviderStarted = new Promise<void>((resolve) => {
    markFastProviderStarted = resolve;
  });
  const query: StreamQuery = { type: "anime", title: "Naruto" };
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "slow-stream",
        async getAvailability(): Promise<MediaAvailability> {
          return new Promise((resolve) => {
            resolveSlowProvider = resolve;
          });
        },
      }),
      createStreamingProvider({
        name: "fast-stream",
        async getAvailability(): Promise<MediaAvailability> {
          markFastProviderStarted?.();
          return createAvailability(query, "fast-stream");
        },
      }),
    ],
  });

  const availabilityPromise = engine.getAvailability(query);
  const fastStartedBeforeSlowFinished = await Promise.race([
    fastProviderStarted.then(() => true),
    sleep(20).then(() => false),
  ]);

  resolveSlowProvider?.(createAvailability(query, "slow-stream"));
  const availability = await availabilityPromise;

  assert.equal(fastStartedBeforeSlowFinished, true);
  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["slow-stream", "fast-stream"],
  );
});

test("getAvailability includes provider timings when debug is enabled", async () => {
  const engine = new MediaEngine({
    debug: true,
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new Error("Availability failed.");
        },
      }),
      createStreamingProvider({ name: "successful-stream" }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(
    availability.meta?.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "failing-stream",
        status: "failed",
        tookMsType: "number",
      },
      {
        provider: "successful-stream",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("getAvailability throws predictably when all selected streaming providers fail", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new Error("Streaming failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getAvailability({ type: "anime", title: "Naruto" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All streaming providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-stream",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Streaming failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("getAvailability applies timeout to streaming providers that do not finish", async () => {
  const engine = new MediaEngine({
    timeoutMs: 1,
    streamingProviders: [
      createStreamingProvider({
        name: "slow-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          await new Promise(() => undefined);
          return null;
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getAvailability({ type: "anime", title: "Naruto" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.deepEqual((error as Error & { cause?: { failed: unknown[] } }).cause?.failed, [
        {
          provider: "slow-stream",
          code: "PROVIDER_TIMEOUT",
          retryable: true,
          message: 'Provider "slow-stream" timed out.',
        },
      ]);
      return true;
    },
  );
});

test("getAvailability cache integration keeps response shape", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const engine = new MediaEngine({
    cache,
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability | null> {
          calls += 1;
          return createAvailability(query, "test-stream");
        },
      }),
    ],
  });

  const first = await engine.getAvailability({ type: "anime", title: "Naruto" });
  const second = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(first).sort(), [
    "checkedAt",
    "episodes",
    "item",
    "meta",
    "options",
    "query",
    "sourceProviders",
  ]);
  assert.deepEqual(Object.keys(second).sort(), [
    "checkedAt",
    "episodes",
    "item",
    "meta",
    "options",
    "query",
    "sourceProviders",
  ]);
  assert.deepEqual(second.options, first.options);
  assert.equal(first.meta?.cached, false);
  assert.equal(second.meta?.cached, true);
});

function createProvider(
  overrides: Partial<MediaProvider> & { apiKey?: string } = {},
): MediaProvider & { apiKey?: string } {
  return {
    name: "test-provider",
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
    },
    async search(): Promise<ProviderSearchResult[]> {
      return [];
    },
    async getDetails(): Promise<ProviderDetailsResult | null> {
      return null;
    },
    ...overrides,
  };
}

function createStreamingProvider(
  overrides: Partial<StreamingProvider> & { secret?: string } = {},
): StreamingProvider & { secret?: string } {
  return {
    name: "test-streaming-provider",
    kind: "streaming",
    capabilities: {
      mediaTypes: ["anime"],
      lookup: {
        byTitle: true,
        byExternalIds: ["shikimori"],
        byEpisode: true,
      },
      features: ["embed", "translations", "qualities", "episode_mapping"],
    },
    async getAvailability(query): Promise<MediaAvailability | null> {
      return createAvailability(query, overrides.name ?? "test-streaming-provider");
    },
    ...overrides,
  };
}

function createAvailability(query: StreamQuery, provider: string): MediaAvailability {
  return {
    query,
    item: {
      type: "anime",
      title: query.title ?? "Naruto",
      ids: query.ids,
    },
    episodes: [
      {
        absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        options: [
          {
            id: `${provider}:episode-1:embed`,
            provider,
            player: {
              kind: "embed",
              label: "Embedded Player",
            },
            translation: {
              title: "Russian dub",
              type: "dub",
              language: "ru",
            },
            quality: {
              label: "720p",
              height: 720,
            },
            episode: {
              absoluteEpisodeNumber: query.absoluteEpisodeNumber,
            },
            access: {
              url: `https://example.test/${provider}/episode-1`,
            },
            availability: "available",
          },
        ],
      },
    ],
    options: [
      {
        id: `${provider}:episode-1:embed`,
        provider,
        player: {
          kind: "embed",
          label: "Embedded Player",
        },
        translation: {
          title: "Russian dub",
          type: "dub",
          language: "ru",
        },
        quality: {
          label: "720p",
          height: 720,
        },
        episode: {
          absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        },
        access: {
          url: `https://example.test/${provider}/episode-1`,
        },
        availability: "available",
      },
    ],
    sourceProviders: [
      {
        provider,
        ids: query.ids,
      },
    ],
    checkedAt: "2026-07-05T00:00:00.000Z",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
