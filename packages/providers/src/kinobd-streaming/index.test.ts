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
  assert.equal(provider.capabilities.features?.includes("embed"), true);
  assert.equal(provider.capabilities.features?.includes("external"), false);
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
        netflix: {
          translate: "Netflix",
          iframe: "https://kinobd.test/film_netflix/94666",
          quality: "auto",
        },
        torrent: {
          translate: "Torrent",
          iframe: "https://kinobd.test/torrent/94666",
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
  assert.equal(requests[1]?.body.get("player")?.includes("ia"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("netflix"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("torrent"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("trailer"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("youtube"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("vk"), true);
  assert.equal(requests[1]?.body.get("player")?.includes("nf"), false);
  assert.equal(availability?.item?.title, "Интерстеллар");
  assert.deepEqual(availability?.item?.ids, {
    imdb: "tt0816692",
    kinopoisk: "258687",
  });
  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["KODIK"],
  );
  assert.deepEqual(
    availability?.options.map((option) => option.player.kind),
    ["embed"],
  );
  assert.equal(availability?.options[0]?.access.url, "https://kodik.test/video/94666");
  assert.equal(availability?.options[0]?.translation?.title, "Дубляж");
  assert.equal(availability?.options[0]?.quality?.height, 1080);
});

test("kinobdStreamingProvider falls back to candidate iframes when playerdata fails", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: async (input, init) => {
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

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
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
        });
      }

      return Response.json({ message: "Bad playerdata" }, { status: 400 });
    },
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

  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[1]?.path, "/playerdata");
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.player.label, "KINOBD");
  assert.equal(availability?.options[0]?.access.url, "https://kinobd.test/player/94666");
  assert.equal(availability?.options[0]?.availability, "available");
});

test("kinobdStreamingProvider prefers exact series candidate over title noise", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "GET /api/player/search": {
        data: [
          {
            id: 428099,
            kinopoisk_id: 916125,
            imdb_id: "tt4437700",
            name_original: "Game of Thrones: A Day in the Life",
            name_russian: "Игра престолов: Один день из жизни",
            year: 2015,
            type: "film",
            popular_rate: 0,
            iframe: '<iframe src="//kinobd.test/player/428099"></iframe>',
          },
          {
            id: 237164,
            kinopoisk_id: 464963,
            imdb_id: "tt0944947",
            name_original: "Game of Thrones",
            name_russian: "Игра престолов",
            year_start: 2011,
            year_end: 2019,
            type: "serial",
            popular_rate: 994347,
            iframe: '<iframe src="//kinobd.test/player/237164"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        collaps: {
          translate: "LostFilm",
          iframe: "//collaps.test/serial/237164/1/1",
          quality: "1080p",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 1,
    },
    {},
  );

  assert.equal(requests[1]?.body.get("inid"), "237164");
  assert.equal(availability?.item?.title, "Игра престолов");
  assert.equal(availability?.item?.originalTitle, "Game of Thrones");
  assert.equal(availability?.item?.year, 2011);
  assert.deepEqual(availability?.item?.ids, {
    imdb: "tt0944947",
    kinopoisk: "464963",
  });
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.access.url, "https://collaps.test/serial/237164/1/1");
});

test("kinobdStreamingProvider blocks noisy non-playback players even when configured", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    playerProviders: "kodik,netflix,torrent,nf,ia,ext,trailer,youtube,trailer_local",
    fetch: createMockFetch(requests, {
      "GET /api/player/search": {
        data: [
          {
            id: 94666,
            kinopoisk_id: 258687,
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
          iframe: "//kodik.test/video/94666",
          quality: "1080p",
        },
        netflix: {
          translate: "Netflix",
          iframe: "https://kinobd.test/film_netflix/94666",
          quality: "auto",
        },
        torrent: {
          translate: "Torrent",
          iframe: "https://kinobd.test/torrent/94666",
          quality: "auto",
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

  assert.equal(requests[1]?.body.get("player"), "kodik");
  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["KODIK"],
  );
  assert.deepEqual(
    availability?.options.map((option) => option.player.kind),
    ["embed"],
  );
});

test("kinobdStreamingProvider maps Shikimori anime cache players into episode options", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    animeCacheBaseUrl: "https://kinobd.test",
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

test("kinobdStreamingProvider falls back from Shikimori ID to KinoBD title search", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    shikimoriBaseUrl: "https://shikimori.test",
    fetch: createMockFetch(requests, {
      "GET /api/animes/20": {
        name: "Naruto",
        russian: "Наруто",
        english: ["Naruto"],
        aired_on: "2002-10-03",
      },
      "GET /api/player/search": {
        data: [
          {
            id: 112166,
            kinopoisk_id: 283290,
            imdb_id: "tt0409591",
            title: "Наруто",
            name_original: "Naruto",
            year: 2002,
            type: "serial",
            iframe: '<iframe src="//kinobd.test/player/112166"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        kodik: {
          translate: "AniDUB",
          iframe: "//kodik.test/anime/20",
          quality: "720p",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      ids: {
        shikimori: "20",
      },
      absoluteEpisodeNumber: 1,
    },
    {},
  );

  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.path, "/api/animes/20");
  assert.equal(requests[1]?.method, "GET");
  assert.equal(requests[1]?.path, "/api/player/search");
  assert.equal(requests[1]?.query.get("q"), "Наруто");
  assert.equal(requests[1]?.query.get("type"), "title");
  assert.equal(availability?.item?.title, "Наруто");
  assert.deepEqual(availability?.item?.ids, {
    imdb: "tt0409591",
    kinopoisk: "283290",
  });
  assert.equal(availability?.item?.type, "anime");
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.player.label, "KODIK");
  assert.equal(availability?.options[0]?.episode?.absoluteEpisodeNumber, 1);
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
