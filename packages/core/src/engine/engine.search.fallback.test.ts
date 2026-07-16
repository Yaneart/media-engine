import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cache } from "../cache/index.js";
import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

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
