import assert from "node:assert/strict";
import { test } from "node:test";

import { kinobdStreamingProvider, type KinoBdStreamingProviderOptions } from "./index.js";

test("kinobdStreamingProvider exposes no-token streaming capabilities", () => {
  const provider = kinobdStreamingProvider();

  assert.equal(provider.name, "kinobd-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series", "anime"]);
  assert.deepEqual(provider.capabilities.lookup.byExternalIds, ["kinopoisk", "shikimori"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
});

test("kinobdStreamingProvider maps movie playerdata into embed options", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "GET /api/player/search": {
        data: [
          {
            id: 94666,
            kinopoisk_id: 258687,
            imdb_id: "tt0816692",
            title: "Интерстеллар",
            name_original: "Interstellar",
            year: 2014,
            iframe: '<iframe src="//kinobd.test/player/94666"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        kodik: {
          translate: "Дубляж",
          iframe: '<iframe data-src="//kodik.test/video/94666"></iframe>',
          quality: "1080p",
        },
        trailer: {
          translate: "Trailer",
          iframe: "https://youtube.test/embed/trailer",
          quality: "auto",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      ids: {
        kinopoisk: "258687",
      },
    },
    {},
  );

  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.path, "/api/player/search");
  assert.equal(requests[0]?.query.get("q"), "258687");
  assert.equal(requests[0]?.query.get("type"), "kp_id");
  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[1]?.path, "/playerdata");
  assert.equal(requests[1]?.search, "?cache94666");
  assert.equal(requests[1]?.body.get("inid"), "94666");
  assert.equal(requests[1]?.body.get("player")?.includes("kodik"), true);
  assert.equal(availability?.item?.title, "Интерстеллар");
  assert.deepEqual(availability?.item?.ids, {
    imdb: "tt0816692",
    kinopoisk: "258687",
  });
  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["KODIK", "TRAILER"],
  );
  assert.equal(availability?.options[0]?.access.url, "https://kodik.test/video/94666");
  assert.equal(availability?.options[0]?.translation?.title, "Дубляж");
  assert.equal(availability?.options[0]?.quality?.height, 1080);
});

test("kinobdStreamingProvider maps Shikimori anime cache players into episode options", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "POST /cache_shiki": {
        "KODIK>AniDUB": {
          translate: "AniDUB",
          iframe: "//kodik.test/anime/20/1",
          quality: "720p",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      title: "Naruto",
      ids: {
        shikimori: "20",
      },
      absoluteEpisodeNumber: 1,
    },
    {},
  );

  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.path, "/cache_shiki");
  assert.equal(requests[0]?.body.get("shikimori"), "20");
  assert.equal(availability?.item?.title, "Naruto");
  assert.equal(availability?.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.equal(availability?.episodes?.[0]?.options.length, 1);
  assert.equal(availability?.options[0]?.player.label, "KODIK");
  assert.equal(availability?.options[0]?.access.url, "https://kodik.test/anime/20/1");
});

test("kinobdStreamingProvider returns empty availability when no player candidate exists", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "GET /api/player/search": {
        data: [],
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      title: "Unknown Movie",
    },
    {},
  );

  assert.deepEqual(availability?.options, []);
  assert.deepEqual(availability?.sourceProviders, []);
});

test("kinobdStreamingProvider respects provider restrictions", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {}),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      title: "Interstellar",
      providers: ["other-streaming"],
    },
    {},
  );

  assert.equal(availability, null);
});

test("kinobdStreamingProvider validates numeric options", () => {
  assert.throws(
    () =>
      kinobdStreamingProvider({
        searchLimit: 0,
      }),
    /searchLimit/,
  );
});

function createProvider(options: Partial<KinoBdStreamingProviderOptions>) {
  return kinobdStreamingProvider({
    baseUrl: "https://kinobd.test",
    ...options,
  });
}

interface RequestRecord {
  method: string;
  path: string;
  search: string;
  query: URLSearchParams;
  body: URLSearchParams;
}

function createMockFetch(requests: RequestRecord[], responses: Record<string, unknown>) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = new URLSearchParams(String(init?.body ?? ""));

    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      query: url.searchParams,
      body,
    });

    return Response.json(responses[`${method} ${url.pathname}`] ?? {});
  };
}
