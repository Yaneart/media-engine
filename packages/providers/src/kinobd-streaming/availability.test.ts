import assert from "node:assert/strict";
import { test } from "node:test";

import { selectBestPlayerCandidate } from "./candidates.js";
import type { KinoBdPlayerAudit } from "./index.js";
import { createMockFetch, createProvider, type RequestRecord } from "./test-helpers.js";

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

test("kinobdStreamingProvider caps actual retry attempts with one operation request budget", async () => {
  let actualRequests = 0;
  const provider = createProvider({
    childRequestLimit: 1,
    fetch: async () => {
      actualRequests += 1;
      return new Response("Unavailable", { status: 503 });
    },
  });

  await assert.rejects(
    provider.getAvailability({ type: "movie", ids: { kinopoisk: "258687" } }, { timeoutMs: 1_000 }),
    { code: "PROVIDER_TIMEOUT", retryable: true },
  );
  assert.equal(actualRequests, 1);
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

test("kinobdStreamingProvider broadens a seasonal anime title only after direct lookup misses", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    shikimoriBaseUrl: "https://shikimori.test",
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

      if (url.pathname === "/api/animes/61316") {
        return Response.json({
          name: "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season",
          russian: "Re:Zero. Жизнь с нуля в альтернативном мире 4",
          english: ["Re:ZERO -Starting Life in Another World- Season 4"],
          aired_on: "2026-04-08",
        });
      }

      if (url.pathname === "/api/player/search") {
        const title = url.searchParams.get("q");

        if (title === "Re:Zero") {
          return Response.json({
            data: [
              {
                id: 133701,
                inid: 133701,
                kinopoisk_id: 971114,
                imdb_id: "tt5607616",
                name_original: "Re:Zero kara Hajimeru Isekai Seikatsu",
                name_russian: "Re:Zero. Жизнь с нуля в альтернативном мире",
                year_start: 2016,
                year_end: "...",
                type: "serial",
              },
            ],
          });
        }

        return Response.json({ data: [] });
      }

      if (url.pathname === "/playerdata") {
        return Response.json({
          kodik: {
            translate: "AniDUB",
            iframe: "//kodik.test/anime/133701",
            quality: "720p",
          },
        });
      }

      return Response.json({});
    },
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      title: "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season",
      year: 2026,
      ids: {
        shikimori: "61316",
      },
    },
    {},
  );

  const searchedTitles = requests
    .filter((request) => request.path === "/api/player/search")
    .map((request) => request.query.get("q"));

  assert.equal(searchedTitles[0], "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season");
  assert.deepEqual(searchedTitles, [
    "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season",
    "Re:Zero kara Hajimeru Isekai Seikatsu",
    "Re:Zero",
  ]);
  assert.equal(requests.filter((request) => request.path === "/api/animes/61316").length, 1);
  const playerDataRequest = requests.find((request) => request.path === "/playerdata");

  assert.equal(playerDataRequest?.body.get("inid"), "133701");
  assert.equal(availability?.query.title, "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season");
  assert.equal(availability?.query.year, 2026);
  assert.equal(availability?.item?.type, "anime");
  assert.equal(availability?.options.length, 1);
});

test("kinobdStreamingProvider does not expand anime titles when direct lookup succeeds", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    shikimoriBaseUrl: "https://shikimori.test",
    fetch: createMockFetch(requests, {
      "GET /api/player/search": {
        data: [
          {
            id: 42,
            name_original: "New Anime",
            year: 2026,
            type: "serial",
            iframe: '<iframe src="//kinobd.test/player/42"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        kodik: {
          translate: "AniDUB",
          iframe: "//kodik.test/anime/42",
          quality: "720p",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      title: "New Anime",
      year: 2026,
      ids: {
        shikimori: "99999",
      },
    },
    {},
  );

  assert.equal(requests.filter((request) => request.path === "/api/player/search").length, 1);
  assert.equal(requests.filter((request) => request.path === "/api/animes/99999").length, 0);
  assert.equal(availability?.options.length, 1);
});

test("selectBestPlayerCandidate accepts open-ended anime series for a later season year", () => {
  const candidate = {
    id: 133701,
    name_original: "Re:Zero kara Hajimeru Isekai Seikatsu",
    year_start: 2016,
    year_end: "...",
    type: "serial",
  };

  assert.equal(
    selectBestPlayerCandidate([candidate], {
      type: "anime",
      title: "Re:Zero",
      year: 2026,
    }),
    candidate,
  );
});

test("selectBestPlayerCandidate rejects a single-year anime record from another year", () => {
  const candidate = {
    id: 99,
    name_original: "Unrelated Reboot",
    year: 2016,
    type: "serial",
  };

  assert.equal(
    selectBestPlayerCandidate([candidate], {
      type: "anime",
      title: "Unrelated Reboot",
      year: 2026,
    }),
    undefined,
  );
});

test("kinobdStreamingProvider bounds slow Shikimori fallback lookup", async () => {
  const requests: string[] = [];
  const provider = createProvider({
    shikimoriBaseUrl: "https://shikimori.test",
    shikimoriLookupTimeoutMs: 1,
    fetch: async (input, init) => {
      const url = new URL(String(input));

      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);

      if (url.pathname === "/api/animes/20") {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Request aborted.", "AbortError"));
          });
        });
      }

      return Response.json({});
    },
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

  assert.deepEqual(requests, ["GET /api/animes/20"]);
  assert.deepEqual(availability?.options, []);
  assert.deepEqual(availability?.sourceProviders, []);
});

test("kinobdStreamingProvider returns empty availability when no player candidate exists", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  const provider = createProvider({
    onPlayerAudit(value) {
      audit = value;
    },
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
  assert.deepEqual(audit?.metrics, {
    discovered: 0,
    validated: 0,
    skippedByLimit: 0,
    skippedByBudget: 0,
    transientUnknown: 0,
    removedConfirmed: 0,
    childRequests: 1,
  });
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
