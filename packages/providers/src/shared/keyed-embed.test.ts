import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderError, type StreamQuery } from "@media-engine/core";
import { allohaStreamingProvider } from "../alloha-streaming/index.js";
import { mirageStreamingProvider } from "../mirage-streaming/index.js";
import { collapsStreamingProvider } from "../collaps-streaming/index.js";
import { videoSeedStreamingProvider } from "../videoseed-streaming/index.js";
import { vibixStreamingProvider } from "../vibix-streaming/index.js";
import { hdvbStreamingProvider } from "../hdvb-streaming/index.js";
import type { KeyedEmbedProviderOptions } from "./keyed-embed.js";

const apiKey = "private-api-credential";
const iframe = "https://player.example/embed/123";
const movie: StreamQuery = {
  type: "movie",
  ids: { kinopoisk: "258687", imdb: "tt0816692", tmdb: "157336" },
};
const episode: StreamQuery = {
  type: "series",
  ids: { kinopoisk: "404900" },
  seasonNumber: 1,
  episodeNumber: 1,
};
const alloha = {
  status: "success",
  data: {
    category: 1,
    name: "Interstellar",
    token_movie: "content123",
    id_kp: 258687,
    id_imdb: "tt0816692",
    id_tmdb: 157336,
    iframe,
    quality: "BDRip",
    translation_iframe: { 66: { name: "Dub", iframe: `${iframe}?translation=66` } },
  },
};
const collaps = {
  results: [
    {
      id: 180,
      type: "film",
      kinopoisk_id: "258687",
      imdb_id: "0816692",
      iframe_url: iframe,
      quality: "FHD (1080p)",
    },
  ],
};
const videoseed = {
  status: "success",
  data: [
    {
      id: "3555",
      type: "movie",
      id_kp: "258687",
      id_imdb: "tt0816692",
      id_tmdb: "157336",
      iframe,
      translation_iframe: {
        dub: { translations_id: "2", short_name: "Dub", iframe: `${iframe}?default_audio_id=2` },
      },
    },
  ],
};
const vibix = {
  id: 938205,
  type: "movie",
  kp_id: 258687,
  imdb_id: "tt0816692",
  iframe_url: "",
  embed_code: 'data-publisher-id="1234" data-type="movie" data-id="4433"',
};
const hdvb = [
  {
    type: "movie",
    kinopoisk_id: 258687,
    token: "content123",
    iframe_url: iframe,
    translator: "Dub",
    translator_id: 107,
    block: false,
  },
];
const definitions = [
  { name: "alloha", factory: allohaStreamingProvider, fixture: alloha, path: "/", param: "kp" },
  { name: "mirage", factory: mirageStreamingProvider, fixture: alloha, path: "/", param: "kp" },
  {
    name: "collaps",
    factory: collapsStreamingProvider,
    fixture: collaps,
    path: "/list",
    param: "kinopoisk_id",
  },
  {
    name: "videoseed",
    factory: videoSeedStreamingProvider,
    fixture: videoseed,
    path: "/apiv2.php",
    param: "kp",
  },
  {
    name: "vibix",
    factory: vibixStreamingProvider,
    fixture: vibix,
    path: "/api/v1/publisher/videos/kp/258687",
    param: undefined,
  },
  {
    name: "hdvb",
    factory: hdvbStreamingProvider,
    fixture: hdvb,
    path: "/api/videos.json",
    param: "id_kp",
  },
];
const clone = <T>(value: T): T => structuredClone(value);
const checkCode = (code: string) => (error: unknown) =>
  error instanceof ProviderError &&
  error.code === code &&
  !JSON.stringify(error).includes(apiKey) &&
  !String(error.cause).includes(apiKey);

for (const { name, factory, fixture, path, param } of definitions) {
  test(`${name}: direct authenticated exact-ID lookup, public attribution and no API secret`, async () => {
    const provider = factory({
      apiKey,
      baseUrl: "https://api.example",
      fetch: async (input, init) => {
        const url = new URL(input);
        assert.equal(url.pathname, path);
        if (param) assert.equal(url.searchParams.get(param), "258687");
        if (name === "vibix") {
          assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${apiKey}`);
          assert.equal(url.searchParams.has("token"), false);
        } else assert.equal(url.searchParams.get("token"), apiKey);
        return Response.json(fixture);
      },
    });
    const result = await provider.getAvailability(movie, {});
    assert.ok(result?.options.length);
    assert.ok(
      result.options.every(
        (o) =>
          o.provider === `${name}-streaming` &&
          o.discovery === "direct" &&
          o.availability === "unknown",
      ),
    );
    assert.equal(JSON.stringify(result).includes(apiKey), false);
    if (name === "vibix")
      assert.equal(
        result.options[0]?.access.url,
        "https://river-3-329.kinescopecdn.net/1234/embed/4433",
      );
  });
  test(`${name}: no unnecessary requests for filters, missing credentials and invalid episode coordinates`, async () => {
    let calls = 0;
    const provider = factory({
      fetch: async () => {
        calls++;
        return Response.json(fixture);
      },
    });
    assert.equal(await provider.getAvailability({ ...movie, providers: ["other"] }, {}), null);
    assert.equal(
      await provider.getAvailability({ type: "movie", ids: { kinopoisk: "0" } }, {}),
      null,
    );
    assert.equal(await provider.getAvailability({ ...episode, episodeNumber: -1 }, {}), null);
    await assert.rejects(provider.getAvailability(movie, {}), checkCode("PROVIDER_UNAUTHORIZED"));
    assert.equal(calls, 0);
  });
  test(`${name}: rejects malformed responses, mismatched identity and movie/series confusion`, async () => {
    const provider = (data: unknown) => factory({ apiKey, fetch: async () => Response.json(data) });
    await assert.rejects(
      provider({ unexpected: true }).getAvailability(movie, {}),
      checkCode("PROVIDER_INVALID_RESPONSE"),
    );
    assert.equal(
      await provider(fixture).getAvailability({ ...movie, ids: { kinopoisk: "999999" } }, {}),
      null,
    );
    assert.equal(
      await provider(fixture).getAvailability({ type: "series", ids: { kinopoisk: "258687" } }, {}),
      null,
    );
    if (name !== "hdvb")
      assert.equal(
        await provider(fixture).getAvailability(
          { ...movie, ids: { kinopoisk: "258687", imdb: "tt9999999" } },
          {},
        ),
        null,
      );
  });
  test(`${name}: HTTP auth/rate errors and transport exceptions cannot disclose API keys`, async () => {
    for (const [status, code] of [
      [401, "PROVIDER_UNAUTHORIZED"],
      [429, "PROVIDER_RATE_LIMITED"],
      [503, "PROVIDER_UNAVAILABLE"],
    ] as const) {
      await assert.rejects(
        factory({ apiKey, fetch: async () => new Response(apiKey, { status }) }).getAvailability(
          movie,
          {},
        ),
        checkCode(code),
      );
    }
    await assert.rejects(
      factory({
        apiKey,
        fetch: async () => {
          throw new Error(`https://secret.example/?token=${apiKey}`);
        },
      }).getAvailability(movie, {}),
      checkCode("PROVIDER_UNAVAILABLE"),
    );
    assert.equal(
      await factory({
        apiKey,
        fetch: async () => new Response("", { status: 404 }),
      }).getAvailability(movie, {}),
      null,
    );
  });
  test(`${name}: bounds bodies and rejects insecure API origins`, async () => {
    assert.throws(() => factory({ baseUrl: "http://api.example" }), TypeError);
    assert.throws(() => factory({ baseUrl: "https://user:pass@api.example" }), TypeError);
    assert.throws(() => factory({ baseUrl: "https://127.0.0.1" }), TypeError);
    assert.throws(() => factory({ maxResponseBytes: 0 }), RangeError);
    await assert.rejects(
      factory({
        apiKey,
        maxResponseBytes: 1024,
        fetch: async () => new Response("x".repeat(1025)),
      }).getAvailability(movie, {}),
      checkCode("PROVIDER_RESPONSE_TOO_LARGE"),
    );
  });
}

for (const [name, factory] of [
  ["alloha", allohaStreamingProvider],
  ["mirage", mirageStreamingProvider],
  ["videoseed", videoSeedStreamingProvider],
] as const) {
  test(`${name}: TMDB request and isolation of server/public player credentials`, async () => {
    const fixture = name === "videoseed" ? clone(videoseed) : clone(alloha);
    const item = Array.isArray(fixture.data) ? fixture.data[0]! : fixture.data;
    item.iframe = `${iframe}?token=${apiKey}`;
    delete (item as Record<string, unknown>).translation_iframe;
    const options: KeyedEmbedProviderOptions = {
      apiKey,
      fetch: async (input) => {
        assert.equal(new URL(input).searchParams.get("tmdb"), "157336");
        return Response.json(fixture);
      },
    };
    const query: StreamQuery = { type: "movie", ids: { tmdb: "157336" } };
    await assert.rejects(
      factory(options).getAvailability(query, {}),
      checkCode("PROVIDER_UNAUTHORIZED"),
    );
    const result = await factory({
      ...options,
      playerToken: "public-player-token",
    }).getAvailability(query, {});
    assert.equal(
      new URL(result!.options[0]!.access.url).searchParams.get("token"),
      "public-player-token",
    );
    assert.equal(JSON.stringify(result).includes(apiKey), false);
    const explicit = await factory({ ...options, allowApiKeyInEmbedUrl: true }).getAvailability(
      query,
      {},
    );
    assert.ok(explicit?.options[0]?.access.url.includes(apiKey));
  });
}

for (const [name, factory] of [
  ["alloha", allohaStreamingProvider],
  ["mirage", mirageStreamingProvider],
  ["collaps", collapsStreamingProvider],
  ["videoseed", videoSeedStreamingProvider],
] as const) {
  test(`${name}: exact catalog episode, missing episodes and anime coordinate proof`, async () => {
    const entry = { iframe, episode: 1 };
    const data =
      name === "collaps"
        ? {
            results: [
              {
                id: 255,
                type: "series",
                kinopoisk_id: "404900",
                iframe_url: iframe,
                seasons: [{ season: 1, episodes: [{ episode: 1, iframe_url: iframe }] }],
              },
            ],
          }
        : name === "videoseed"
          ? {
              status: "success",
              data: [
                {
                  id: "23",
                  type: "serial",
                  id_kp: "404900",
                  iframe,
                  seasons: { 1: { videos: { 1: { iframe } } } },
                },
              ],
            }
          : {
              status: "success",
              data: {
                category: 2,
                token_movie: "series123",
                id_kp: 404900,
                iframe,
                seasons: { 1: { season: 1, episodes: { 1: entry } } },
              },
            };
    const provider = factory({ apiKey, fetch: async () => Response.json(data) });
    const result = await provider.getAvailability(episode, {});
    assert.ok(result?.options.length);
    assert.deepEqual(result.options[0]?.episode, { seasonNumber: 1, episodeNumber: 1 });
    assert.equal(await provider.getAvailability({ ...episode, episodeNumber: 2 }, {}), null);
    const anime: StreamQuery = {
      ...episode,
      type: "anime",
      animeKind: "ona",
      ids: { kinopoisk: "404900", shikimori: "1" },
      absoluteEpisodeNumber: 1,
    };
    assert.ok((await provider.getAvailability(anime, {}))?.options.length);
    assert.equal(await provider.getAvailability({ ...anime, absoluteEpisodeNumber: 2 }, {}), null);
    assert.equal(
      await provider.getAvailability({ ...anime, ids: { kinopoisk: "404900" } }, {}),
      null,
    );
  });
}

test("Vibix rejects ambiguous SDK attributes and keeps its API id separate from the embed id", async () => {
  await assert.rejects(
    vibixStreamingProvider({
      apiKey,
      fetch: async () =>
        Response.json({ ...vibix, embed_code: vibix.embed_code + ' data-id="999"' }),
    }).getAvailability(movie, {}),
    checkCode("PROVIDER_INVALID_RESPONSE"),
  );
});
test("HDVB filters blocked players and does not advertise unsupported TMDB/episode lookup", async () => {
  const provider = hdvbStreamingProvider({
    apiKey,
    fetch: async () => Response.json([{ ...hdvb[0], block: true }]),
  });
  assert.equal(await provider.getAvailability(movie, {}), null);
  assert.deepEqual(provider.capabilities.lookup.byExternalIds, ["kinopoisk"]);
  assert.equal(provider.capabilities.lookup.byEpisode, false);
});
test("Collaps never treats an ignored TMDB filter as a successful lookup", async () => {
  let calls = 0;
  const provider = collapsStreamingProvider({
    apiKey,
    fetch: async () => {
      calls++;
      return Response.json(collaps);
    },
  });
  assert.equal(
    await provider.getAvailability({ type: "movie", ids: { tmdb: "157336" } }, {}),
    null,
  );
  assert.equal(calls, 0);
});
test("Collaps accepts its actual anime-film and anime-series catalog types", async () => {
  const provider = collapsStreamingProvider({
    apiKey,
    fetch: async () => Response.json({ results: [{ ...collaps.results[0], type: "anime-film" }] }),
  });
  assert.ok(
    (await provider.getAvailability({ ...movie, type: "anime", animeKind: "movie" }, {}))?.options
      .length,
  );
});
test("Embed deadlines report timeout even when the response body stalls", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      allohaStreamingProvider({
        apiKey,
        fetch: async () => new Response(new ReadableStream({ start() {} })),
      }).getAvailability(movie, { timeoutMs: 5 }),
      checkCode("PROVIDER_TIMEOUT"),
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
test("Caller cancellation is preserved and expired requests never fetch", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped");
  controller.abort(reason);
  let calls = 0;
  const provider = allohaStreamingProvider({
    apiKey,
    fetch: async () => {
      calls++;
      return Response.json(alloha);
    },
  });
  await assert.rejects(
    provider.getAvailability(movie, { signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    provider.getAvailability(movie, { timeoutMs: 0 }),
    checkCode("PROVIDER_TIMEOUT"),
  );
  assert.equal(calls, 0);
});
