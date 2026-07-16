import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { MediaEngineError } from "../errors/index.js";
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
