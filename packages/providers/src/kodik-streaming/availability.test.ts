import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngine, ProviderError, type StreamingProvider } from "@media-engine/core";
import { kodikStreamingProvider } from "./index.js";

test("kodikStreamingProvider maps direct movie translations and provenance", async () => {
  const provider = createProvider([movieFixture()]);
  const result = await provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "1043758", imdb: "tt6751668" } },
    {},
  );

  assert.equal(result?.options[0]?.discovery, "direct");
  assert.equal(result?.options[0]?.player.provider, "kodik");
  assert.equal(result?.options[0]?.access.url, "https://kodik.test/video/39523");
  assert.deepEqual(result?.options[0]?.translation, {
    id: "704",
    title: "Дублированный",
    type: "voiceover",
    language: "ru",
    team: "Дублированный",
  });
  assert.deepEqual(result?.options[0]?.quality, { label: "BDRip 720p", height: 720 });
});

test("kodikStreamingProvider returns only the exact requested series episode", async () => {
  const provider = createProvider([seriesFixture()]);
  const result = await provider.getAvailability(
    {
      type: "series",
      ids: { kinopoisk: "464963", imdb: "tt0944947" },
      seasonNumber: 2,
      episodeNumber: 1,
    },
    {},
  );

  assert.equal(result?.options.length, 1);
  assert.equal(result?.options[0]?.access.url, "https://kodik.test/got/s02e01");
  assert.deepEqual(result?.options[0]?.episode, { seasonNumber: 2, episodeNumber: 1 });
  assert.equal(
    await provider.getAvailability(
      { type: "series", ids: { kinopoisk: "464963" }, seasonNumber: 2, episodeNumber: 9 },
      {},
    ),
    null,
  );
});

test("kodikStreamingProvider maps a split anime release to its provider episode", async () => {
  const requestedUrls: string[] = [];
  const provider = kodikStreamingProvider({
    apiKey: "owned-secret",
    fetch: async (input) => {
      requestedUrls.push(input.toString());
      return Response.json({ results: [animeFixture()] });
    },
  });
  const query = {
    type: "anime" as const,
    animeKind: "tv" as const,
    ids: { shikimori: "60000", kinopoisk: "5401195" },
    seasonNumber: 2,
    episodeNumber: 2,
    absoluteEpisodeNumber: 30,
    animeReleaseEpisode: {
      releaseIndex: 1,
      releaseEpisodeNumber: 2,
      releaseEpisodeCounts: [28, 12],
    },
  };

  const result = await provider.getAvailability(query, {});

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0]!, /shikimori_id=60000/u);
  assert.equal(result?.options[0]?.access.url, "https://kodik.test/frieren/s01e02");
  assert.deepEqual(result?.options[0]?.episode, {
    seasonNumber: 2,
    episodeNumber: 2,
    absoluteEpisodeNumber: 30,
  });

  assert.equal(await provider.getAvailability({ ...query, absoluteEpisodeNumber: 29 }, {}), null);
});

test("kodikStreamingProvider maps a release-local split season with a noncanonical season key", async () => {
  const release = animeFixture();
  const season = release.seasons["1"];
  (release as { seasons: Record<string, typeof season> }).seasons = { "2": season };
  const provider = createProvider([release]);
  const result = await provider.getAvailability(
    {
      type: "anime",
      animeKind: "tv",
      ids: { shikimori: "60000", kinopoisk: "5401195" },
      seasonNumber: 2,
      episodeNumber: 2,
      absoluteEpisodeNumber: 30,
      animeReleaseEpisode: {
        releaseIndex: 1,
        releaseEpisodeNumber: 2,
        releaseEpisodeCounts: [28, 12],
      },
    },
    {},
  );

  assert.equal(result?.options[0]?.access.url, "https://kodik.test/frieren/s01e02");
  assert.deepEqual(result?.options[0]?.episode, {
    seasonNumber: 2,
    episodeNumber: 2,
    absoluteEpisodeNumber: 30,
  });
});

test("kodikStreamingProvider rejects conflicting identity and media type", async () => {
  const provider = createProvider([movieFixture()]);
  assert.equal(
    await provider.getAvailability(
      { type: "movie", ids: { kinopoisk: "1043758", imdb: "tt0000001" } },
      {},
    ),
    null,
  );
  assert.equal(
    await provider.getAvailability({ type: "series", ids: { kinopoisk: "1043758" } }, {}),
    null,
  );
});

test("kodikStreamingProvider avoids underidentified requests and preserves cancellation", async () => {
  let calls = 0;
  const provider = kodikStreamingProvider({
    apiKey: "owned-secret",
    fetch: async () => {
      calls += 1;
      return Response.json({ results: [] });
    },
  });
  for (const query of [
    { type: "movie" as const, title: "Movie" },
    { type: "movie" as const, ids: { kinopoisk: "1" }, seasonNumber: 1 },
    { type: "series" as const, ids: { kinopoisk: "1" }, episodeNumber: 1 },
    { type: "anime" as const, animeKind: "tv" as const, ids: { shikimori: "20" } },
    { type: "movie" as const, ids: { kinopoisk: "1" }, providers: ["other"] },
  ]) {
    assert.equal(await provider.getAvailability(query, {}), null);
  }
  assert.equal(calls, 0);

  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const cancelling = kodikStreamingProvider({
    apiKey: "owned-secret",
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
      ),
  });
  const pending = cancelling.getAvailability(
    { type: "movie", ids: { kinopoisk: "1" } },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);
  await assert.rejects(pending, (error) => error === cancellation);
});

test("kodikStreamingProvider reports typed schema errors without its secret", async () => {
  const provider = kodikStreamingProvider({
    apiKey: "owned-secret",
    fetch: async () => Response.json({ results: [{ token: "upstream-secret" }] }),
  });
  await assert.rejects(
    provider.getAvailability({ type: "movie", ids: { kinopoisk: "1" } }, {}),
    (error) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_INVALID_RESPONSE" &&
      !JSON.stringify(error).includes("owned-secret") &&
      !error.message.includes("upstream-secret"),
  );
});

test("MediaEngine prefers direct Kodik over an equivalent aggregate observation", async () => {
  const direct = createProvider([movieFixture()]);
  const aggregate: StreamingProvider = {
    name: "aggregate",
    kind: "streaming",
    capabilities: direct.capabilities,
    async getAvailability(query) {
      return {
        query,
        options: [
          {
            id: "aggregate:kodik",
            provider: "aggregate",
            discovery: "aggregate",
            player: { kind: "embed", label: "KODIK", provider: "kodik" },
            access: { url: "https://kodik.test/video/39523" },
            availability: "available",
          },
        ],
        sourceProviders: [{ provider: "aggregate" }],
        checkedAt: "2026-10-08T12:00:00.000Z",
      };
    },
  };
  const engine = new MediaEngine({ streamingProviders: [aggregate, direct] });

  const result = await engine.getAvailability({
    type: "movie",
    ids: { kinopoisk: "1043758", imdb: "tt6751668" },
  });

  assert.equal(result.options.length, 1);
  assert.equal(result.options[0]?.provider, "kodik-streaming");
  assert.deepEqual(
    result.options[0]?.attributions?.map((attribution) => attribution.provider),
    ["aggregate", "kodik-streaming"],
  );
});

function createProvider(results: unknown[]) {
  return kodikStreamingProvider({
    apiKey: "owned-secret",
    now: () => Date.parse("2026-10-08T12:00:00.000Z"),
    fetch: async () => Response.json({ results }),
  });
}

function movieFixture() {
  return {
    id: "movie-39523",
    type: "foreign-movie",
    link: "//kodik.test/video/39523",
    title: "Паразиты",
    title_orig: "Gisaengchung",
    year: 2019,
    kinopoisk_id: "1043758",
    imdb_id: "tt6751668",
    translation: { id: 704, title: "Дублированный", type: "voice" },
    quality: "BDRip 720p",
    blocked_countries: [],
    blocked_seasons: {},
  };
}

function seriesFixture() {
  return {
    id: "serial-1",
    type: "foreign-serial",
    link: "//kodik.test/got",
    title: "Игра престолов",
    year: 2011,
    kinopoisk_id: "464963",
    imdb_id: "tt0944947",
    translation: { id: 1, title: "LostFilm", type: "voice" },
    blocked_countries: [],
    blocked_seasons: {},
    seasons: {
      "1": { episodes: { "1": "//kodik.test/got/s01e01" } },
      "2": { episodes: { "1": "//kodik.test/got/s02e01" } },
    },
  };
}

function animeFixture() {
  return {
    id: "serial-2",
    type: "anime-serial",
    link: "//kodik.test/frieren",
    title: "Фрирен [ТВ-2]",
    year: 2026,
    kinopoisk_id: "5401195",
    shikimori_id: "60000",
    translation: { id: 2, title: "AniLibria.TV", type: "voice" },
    blocked_countries: [],
    blocked_seasons: {},
    seasons: {
      "1": {
        episodes: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [
            String(index + 1),
            `//kodik.test/frieren/s01e${String(index + 1).padStart(2, "0")}`,
          ]),
        ),
      },
    },
  };
}
