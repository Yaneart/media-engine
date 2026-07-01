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

test("search rejects empty queries predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.search({}), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Search query must include title or external ids.",
  });
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
    (error) => {
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
    (error) => {
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
