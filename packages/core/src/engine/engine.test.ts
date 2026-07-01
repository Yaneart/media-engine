import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
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
