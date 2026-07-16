import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import type { MediaDetails } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { MediaSearchResult } from "../search/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider, createStreamingProvider } from "./test-helpers.js";

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
