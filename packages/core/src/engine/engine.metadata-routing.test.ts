import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCache } from "../cache/index.js";
import { ProviderError } from "../errors/index.js";
import type { MovieDetails } from "../media/index.js";
import {
  createDetailsResult,
  createMockProvider,
  createSearchResult,
  type MockProviderOptions,
} from "../testing/index.js";
import { MediaEngine } from "./engine.js";

const completeMovie: MovieDetails = {
  id: "tmdb-official-movie-157336",
  type: "movie",
  title: "Интерстеллар",
  originalTitle: "Interstellar",
  description: "Исследователи отправляются сквозь червоточину.",
  year: 2014,
  poster: { url: "https://image.test/poster.jpg", type: "poster" },
  backdrop: { url: "https://image.test/backdrop.jpg", type: "backdrop" },
  ids: { tmdb: "157336", imdb: "tt0816692" },
  sourceProviders: [{ provider: "tmdb-official", ids: { tmdb: "157336", imdb: "tt0816692" } }],
};

function provider(
  name: string,
  route: "primary" | "fallback",
  getDetails: NonNullable<MockProviderOptions["getDetails"]>,
) {
  return createMockProvider({
    name,
    capabilities: {
      mediaTypes: ["movie"],
      metadataRoute: route,
      details: { byExternalIds: ["tmdb", "imdb"] },
    },
    getDetails,
  });
}

test("routed details returns one coherent primary snapshot without touching fallback", async () => {
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      provider("tmdb-official", "primary", () =>
        createDetailsResult("tmdb-official", completeMovie),
      ),
      provider("legacy", "fallback", () => {
        fallbackCalls += 1;
        return createDetailsResult("legacy", {
          ...completeMovie,
          title: "Legacy title",
          sourceProviders: [{ provider: "legacy", ids: completeMovie.ids }],
        });
      }),
    ],
  });

  const response = await engine.getDetails({
    type: "movie",
    ids: { tmdb: "157336", imdb: "tt0816692" },
    language: "ru",
  });

  assert.equal(response.details?.title, "Интерстеллар");
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(response.meta.providers.requested, ["tmdb-official"]);
  assert.deepEqual(response.meta.metadata, {
    route: "primary",
    freshness: "fresh",
    providers: ["tmdb-official"],
    fetchedAt: response.meta.metadata?.fetchedAt,
  });
});

test("routed search does not wait for legacy discovery after a healthy primary", async () => {
  let fallbackCalls = 0;
  const primary = createMockProvider({
    name: "tmdb-official",
    capabilities: { mediaTypes: ["movie"], metadataRoute: "primary" },
    searchResults: [createSearchResult("tmdb-official", completeMovie)],
  });
  const fallback = createMockProvider({
    name: "legacy",
    capabilities: { mediaTypes: ["movie"], metadataRoute: "fallback" },
    search() {
      fallbackCalls += 1;
      return [];
    },
  });
  const engine = new MediaEngine({ providers: [primary, fallback] });

  const response = await engine.search({ title: "Интерстеллар", type: "movie", language: "ru" });
  assert.equal(response.results[0]?.item.title, "Интерстеллар");
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(response.meta.providers.requested, ["tmdb-official"]);
});

test("routed search keeps distinct exact primary matches without legacy disambiguation", async () => {
  let fallbackCalls = 0;
  const primary = createMockProvider({
    name: "tmdb-official",
    capabilities: { mediaTypes: ["movie"], metadataRoute: "primary" },
    searchResults: [
      createSearchResult("tmdb-official", completeMovie),
      createSearchResult("tmdb-official", {
        ...completeMovie,
        id: "tmdb-official-movie-999",
        year: 2024,
        ids: { tmdb: "999" },
      }),
    ],
  });
  const fallback = createMockProvider({
    name: "legacy",
    capabilities: { mediaTypes: ["movie"], metadataRoute: "fallback" },
    search() {
      fallbackCalls += 1;
      return [];
    },
  });
  const engine = new MediaEngine({ providers: [primary, fallback] });

  const response = await engine.search({ title: "Интерстеллар", type: "movie", language: "ru" });
  assert.equal(response.results.length, 2);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(response.meta.providers.requested, ["tmdb-official"]);
});

test("routed search serves stale immediately and coalesces one background refresh", async () => {
  let now = 0;
  let calls = 0;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const cache = new MemoryCache({ now: () => now });
  const primary = createMockProvider({
    name: "tmdb-official",
    capabilities: { mediaTypes: ["movie"], metadataRoute: "primary" },
    async search() {
      calls += 1;
      if (calls > 1) await refreshGate;
      return [createSearchResult("tmdb-official", completeMovie)];
    },
  });
  const engine = new MediaEngine({ cache, providers: [primary] });
  const query = { title: "Интерстеллар", type: "movie" as const, language: "ru" };
  await engine.search(query);
  now = 5 * 60_000 + 1;

  const [first, second] = await Promise.all([engine.search(query), engine.search(query)]);
  assert.equal(first.meta.stale, true);
  assert.equal(first.meta.cached, true);
  assert.equal(second.meta.stale, true);
  assert.ok(first.meta.warnings?.some((warning) => warning.code === "STALE_CACHE_FALLBACK"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  releaseRefresh();
});

test("routed Russian search does not use AniList as title discovery fallback", async () => {
  let anilistCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createMockProvider({
        name: "shikimori-graphql",
        capabilities: { mediaTypes: ["anime"], metadataRoute: "primary" },
        searchResults: [],
      }),
      createMockProvider({
        name: "anilist",
        capabilities: { mediaTypes: ["anime"], metadataRoute: "fallback" },
        search() {
          anilistCalls += 1;
          return [];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Attack on Titan", type: "anime" });
  assert.deepEqual(response.results, []);
  assert.equal(anilistCalls, 0);
  assert.deepEqual(response.meta.providers.requested, ["shikimori-graphql"]);
});

test("routed details falls back on an incomplete primary and reports safe provenance", async () => {
  const incomplete = { ...completeMovie, description: undefined };
  const engine = new MediaEngine({
    providers: [
      provider("tmdb-official", "primary", () => createDetailsResult("tmdb-official", incomplete)),
      provider("legacy", "fallback", () =>
        createDetailsResult("legacy", {
          ...completeMovie,
          sourceProviders: [{ provider: "legacy", ids: completeMovie.ids }],
        }),
      ),
    ],
  });

  const response = await engine.getDetails({ type: "movie", ids: { tmdb: "157336" } });
  assert.equal(response.details?.title, "Интерстеллар");
  assert.equal(response.meta.metadata?.route, "fallback");
  assert.deepEqual(response.meta.metadata?.providers, ["legacy"]);
  assert.ok(response.meta.warnings?.some((warning) => warning.code === "METADATA_FALLBACK_USED"));
  assert.ok(
    response.meta.providers.failed.some(
      (failure) =>
        failure.provider === "tmdb-official" && failure.code === "PROVIDER_INVALID_RESPONSE",
    ),
  );
});

test("routed details retries one transient primary failure inside the shared budget", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const engine = new MediaEngine({
    providers: [
      provider("tmdb-official", "primary", () => {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          throw new ProviderError({
            provider: "tmdb-official",
            code: "PROVIDER_UNAVAILABLE",
            message: "raw upstream detail",
            retryable: true,
          });
        }
        return createDetailsResult("tmdb-official", completeMovie);
      }),
      provider("legacy", "fallback", () => {
        fallbackCalls += 1;
        return null;
      }),
    ],
    providerTimeouts: { "tmdb-official": 2_000 },
  });

  const response = await engine.getDetails({ type: "movie", ids: { tmdb: "157336" } });
  assert.equal(response.details?.title, "Интерстеллар");
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 0);
  assert.equal(response.meta.providers.failed[0]?.message.includes("raw upstream detail"), false);
  assert.equal(response.meta.debug, undefined);
});

test("routed details serves stale immediately and coalesces one background refresh", async () => {
  let now = 0;
  let calls = 0;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const cache = new MemoryCache({ now: () => now });
  const engine = new MediaEngine({
    cache,
    providers: [
      provider("tmdb-official", "primary", async () => {
        calls += 1;
        if (calls > 1) await refreshGate;
        return createDetailsResult("tmdb-official", completeMovie);
      }),
    ],
  });
  const query = { type: "movie" as const, ids: { tmdb: "157336" } };
  await engine.getDetails(query);
  now = 5 * 60_000 + 1;

  const [first, second] = await Promise.all([engine.getDetails(query), engine.getDetails(query)]);
  assert.equal(first.meta.stale, true);
  assert.equal(first.meta.metadata?.freshness, "stale");
  assert.equal(second.meta.stale, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  releaseRefresh();
});

test("routed details never accepts a fallback with a conflicting exact identity", async () => {
  const engine = new MediaEngine({
    providers: [
      provider("tmdb-official", "primary", () => null),
      provider("legacy", "fallback", () =>
        createDetailsResult("legacy", {
          ...completeMovie,
          ids: { tmdb: "999" },
          sourceProviders: [{ provider: "legacy", ids: { tmdb: "999" } }],
        }),
      ),
    ],
  });
  const response = await engine.getDetails({ type: "movie", ids: { tmdb: "157336" } });
  assert.equal(response.details, null);
  assert.equal(response.meta.metadata, undefined);
});

test("routed Russian details never accepts AniList as a standalone text source", async () => {
  const engine = new MediaEngine({
    providers: [
      provider("tmdb-official", "primary", () => null),
      provider("anilist", "fallback", () =>
        createDetailsResult("anilist", {
          ...completeMovie,
          title: "Interstellar",
          description: "Explorers travel through a wormhole.",
          sourceProviders: [{ provider: "anilist", ids: completeMovie.ids }],
        }),
      ),
    ],
  });

  const response = await engine.getDetails({ type: "movie", ids: { tmdb: "157336" } });
  assert.equal(response.details, null);
  assert.equal(response.meta.metadata, undefined);
});
