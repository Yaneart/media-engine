import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cache } from "../cache/index.js";
import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("search skips fallback discovery after one exact primary identity", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "primary-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "primary-provider",
              item: { id: "interstellar", type: "movie", title: "Interstellar", year: 2014 },
            },
          ];
        },
      }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(response.results[0]?.item.title, "Interstellar");
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(response.meta.providers.requested, ["primary-provider"]);
  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => timing.phase),
    ["primary"],
  );
});

test("search invokes fallback discovery after empty primary discovery", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({ name: "primary-provider" }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [
            {
              provider: "fallback-provider",
              item: { id: "sopranos", type: "series", title: "The Sopranos", year: 1999 },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "The Sopranos" });

  assert.equal(response.results[0]?.item.title, "The Sopranos");
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(response.meta.providers.requested, ["primary-provider", "fallback-provider"]);
  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => timing.phase),
    ["primary", "provider_fallback"],
  );
});

test("search invokes fallback discovery for conflicting exact title identities", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "primary-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "primary-provider",
              item: { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
            },
            {
              provider: "primary-provider",
              item: { id: "dune-old", type: "movie", title: "Dune", year: 2006 },
            },
          ];
        },
      }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie", "series"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [
            {
              provider: "fallback-provider",
              item: { id: "dune-2021", type: "movie", title: "Dune", year: 2021 },
            },
          ];
        },
      }),
    ],
  });

  await engine.search({ title: "Dune" });

  assert.equal(fallbackCalls, 1);
});

test("search skips exact-title ambiguity fallback when a broader candidate ranks first", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "primary-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "primary-provider",
              confidence: 1,
              item: {
                id: "one-piece",
                type: "anime",
                title: "One Piece",
                year: 1999,
                ratings: [{ source: "imdb", value: 9, max: 10, votes: 10_000_000 }],
              },
            },
            {
              provider: "primary-provider",
              confidence: 0.2,
              item: { id: "one-a", type: "movie", title: "One", year: 2017 },
            },
            {
              provider: "primary-provider",
              confidence: 0.1,
              item: { id: "one-b", type: "movie", title: "ONE", year: 2020 },
            },
          ];
        },
      }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie", "series"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "One" });

  assert.equal(response.results[0]?.item.title, "One Piece");
  assert.equal(fallbackCalls, 0);
});

test("search broadens a typo with primary providers before fallback discovery", async () => {
  const primaryQueries: string[] = [];
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "primary-provider",
        async search(query): Promise<ProviderSearchResult[]> {
          primaryQueries.push(query.title ?? "");
          return query.title === "game of"
            ? [
                {
                  provider: "primary-provider",
                  item: { id: "got", type: "series", title: "Game of Thrones", year: 2011 },
                },
              ]
            : [
                {
                  provider: "primary-provider",
                  item: {
                    id: "documentary",
                    type: "movie",
                    title: "Game of Thrones: The Last Watch",
                    year: 2019,
                  },
                },
              ];
        },
      }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie", "series"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "game of throen" });

  assert.equal(response.results[0]?.item.title, "Game of Thrones");
  assert.deepEqual(primaryQueries, ["game of throen", "game of"]);
  assert.equal(fallbackCalls, 0);
});

test("search invokes fallback discovery for a multi-word prefix without an exact identity", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "primary-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "primary-provider",
              item: { id: "game-of-dice", type: "anime", title: "Game of Dice", year: 2020 },
            },
          ];
        },
      }),
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: true, byExternalIds: [], titleDiscovery: "fallback" },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          fallbackCalls += 1;
          return [
            {
              provider: "fallback-provider",
              item: {
                id: "game-of-thrones",
                type: "series",
                title: "Game of Thrones",
                year: 2011,
                ids: { imdb: "tt0944947" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "game of" });

  assert.equal(fallbackCalls, 1);
  assert.ok(response.results.some((result) => result.item.id === "game-of-thrones"));
});

test("search runs a fallback title provider normally for a supported external ID", async () => {
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "fallback-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: {
            byTitle: true,
            byExternalIds: ["imdb"],
            titleDiscovery: "fallback",
          },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "fallback-provider",
              item: {
                id: "dune",
                type: "movie",
                title: "Dune",
                year: 2021,
                ids: { imdb: "tt1160419" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ ids: { imdb: "tt1160419" } });

  assert.equal(response.results[0]?.item.title, "Dune");
  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => timing.phase),
    ["primary"],
  );
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

test("search reports retryable fallback failures and retries before caching a recovery", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
        name: "fallback-provider",
        async search(query): Promise<ProviderSearchResult[]> {
          if (query.title === "game of") {
            fallbackCalls += 1;

            if (fallbackCalls === 1) {
              throw new ProviderError({
                provider: "fallback-provider",
                code: "PROVIDER_TIMEOUT",
                retryable: true,
                message: "Fallback timed out.",
              });
            }

            return [
              {
                provider: "fallback-provider",
                item: {
                  id: "game-of-thrones",
                  type: "series",
                  title: "Game of Thrones",
                  year: 2011,
                },
              },
            ];
          }

          primaryCalls += 1;
          return [
            {
              provider: "fallback-provider",
              item: {
                id: "unrelated",
                type: "movie",
                title: "Throne of Elves",
                year: 2016,
              },
            },
          ];
        },
      }),
    ],
  });

  const first = await engine.search({ title: "game of throen" });
  const second = await engine.search({ title: "game of throen" });
  const third = await engine.search({ title: "game of throen" });

  assert.deepEqual(first.results, []);
  assert.equal(first.meta.cached, false);
  assert.deepEqual(first.meta.providers.failed, [
    {
      provider: "fallback-provider",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      message: "Fallback timed out.",
      phase: "fallback",
    },
  ]);
  assert.deepEqual(
    first.meta.debug?.timings.map(({ phase, status }) => ({ phase, status })),
    [
      { phase: "primary", status: "success" },
      { phase: "fallback", status: "failed" },
    ],
  );
  assert.equal(second.results[0]?.item.title, "Game of Thrones");
  assert.equal(second.meta.cached, false);
  assert.deepEqual(second.meta.providers.failed, []);
  assert.equal(third.meta.cached, true);
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 2);
});

test("search exposes and caches non-retryable fallback failures", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    providers: [
      createProvider({
        name: "fallback-provider",
        async search(query): Promise<ProviderSearchResult[]> {
          calls += 1;

          if (query.title === "game of") {
            throw new ProviderError({
              provider: "fallback-provider",
              code: "PROVIDER_INVALID_RESPONSE",
              retryable: false,
              message: "Fallback response was invalid.",
            });
          }

          return [
            {
              provider: "fallback-provider",
              item: {
                id: "unrelated",
                type: "movie",
                title: "Throne of Elves",
                year: 2016,
              },
            },
          ];
        },
      }),
    ],
  });

  const first = await engine.search({ title: "game of throen" });
  const second = await engine.search({ title: "game of throen" });

  assert.deepEqual(first.meta.providers.failed, [
    {
      provider: "fallback-provider",
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: false,
      message: "Fallback response was invalid.",
      phase: "fallback",
    },
  ]);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.deepEqual(second.meta.providers.failed, first.meta.providers.failed);
  assert.equal(calls, 2);
});

test("search keeps one phase-aware public failure per fallback provider", async () => {
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "unstable-provider",
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "unstable-provider",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            message: "Provider timed out.",
          });
        },
      }),
      createProvider({
        name: "stable-provider",
        async search(query): Promise<ProviderSearchResult[]> {
          return query.title === "game of throen"
            ? [
                {
                  provider: "stable-provider",
                  item: {
                    id: "unrelated",
                    type: "movie",
                    title: "Throne of Elves",
                    year: 2016,
                  },
                },
              ]
            : [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "game of throen" });

  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "unstable-provider",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      message: "Provider timed out.",
      phase: "fallback",
    },
  ]);
  assert.deepEqual(
    response.meta.debug?.timings
      .filter((timing) => timing.provider === "unstable-provider")
      .map(({ phase, status }) => ({ phase, status })),
    [
      { phase: "primary", status: "failed" },
      { phase: "fallback", status: "failed" },
    ],
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
          phase: "retry",
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

test("search does not cache partial results after a retryable provider failure", async () => {
  let stableCalls = 0;
  let recoveringCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    providers: [
      createProvider({
        name: "stable-provider",
        async search(): Promise<ProviderSearchResult[]> {
          stableCalls += 1;

          return [
            {
              provider: "stable-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
              },
            },
          ];
        },
      }),
      createProvider({
        name: "recovering-provider",
        async search(): Promise<ProviderSearchResult[]> {
          recoveringCalls += 1;

          if (recoveringCalls === 1) {
            throw new ProviderError({
              provider: "recovering-provider",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Provider timed out.",
            });
          }

          return [
            {
              provider: "recovering-provider",
              item: {
                id: "movie-2",
                type: "movie",
                title: "Interstellar: The Missing Film",
              },
            },
          ];
        },
      }),
    ],
  });

  const first = await engine.search({ title: "Interstellar", limit: 10 });
  const second = await engine.search({ title: "Interstellar", limit: 10 });
  const third = await engine.search({ title: "Interstellar", limit: 10 });

  assert.deepEqual(
    first.results.map((result) => result.item.id),
    ["movie-1"],
  );
  assert.equal(first.meta.cached, false);
  assert.equal(first.meta.providers.failed[0]?.code, "PROVIDER_TIMEOUT");
  assert.deepEqual(second.results.map((result) => result.item.id).sort(), ["movie-1", "movie-2"]);
  assert.equal(second.meta.cached, false);
  assert.equal(third.meta.cached, true);
  assert.equal(stableCalls, 2);
  assert.equal(recoveringCalls, 2);
});

test("search isolates responses from a reference-based custom cache", async () => {
  let calls = 0;
  const values = new Map<string, unknown>();
  const cache: Cache = {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      values.set(key, value);
    },
    delete(key: string): void {
      values.delete(key);
    },
    clear(): void {
      values.clear();
    },
  };
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
  first.results[0]!.item.title = "Changed first response";
  const second = await engine.search({ title: "Interstellar" });
  assert.equal(second.results[0]?.item.title, "Interstellar");
  second.results[0]!.item.title = "Changed cached response";
  const third = await engine.search({ title: "Interstellar" });

  assert.equal(calls, 1);
  assert.equal(second.meta.cached, true);
  assert.equal(third.meta.cached, true);
  assert.equal(third.results[0]?.item.title, "Interstellar");
});

test("search returns stale cached data after retryable provider failure", async () => {
  let now = 1_000;
  let available = true;
  const cache = new MemoryCache({
    now: () => now,
    defaultTtlMs: 100,
    defaultStaleTtlMs: 1_000,
  });
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          if (!available) {
            throw new ProviderError({
              provider: "test-provider",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Provider timed out.",
            });
          }

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

  await engine.search({ title: "Interstellar" });
  available = false;
  now = 1_101;
  const response = await engine.search({ title: "Interstellar" });

  assert.equal(response.results[0]?.item.title, "Interstellar");
  assert.equal(response.meta.cached, true);
  assert.equal(response.meta.stale, true);
  assert.deepEqual(response.meta.providers.successful, []);
  assert.equal(response.meta.providers.failed[0]?.code, "PROVIDER_TIMEOUT");
  assert.equal(response.meta.warnings?.[0]?.code, "STALE_CACHE_FALLBACK");
});
