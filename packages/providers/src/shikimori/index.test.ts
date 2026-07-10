import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { shikimoriProvider, type ShikimoriProviderOptions } from "./index.js";

test("shikimoriProvider exposes safe anime metadata capabilities", () => {
  const provider = shikimoriProvider({
    userAgent: "MediaEngineTest/0.0.0",
  });

  assert.equal(provider.name, "shikimori");
  assert.equal(provider.kind, "metadata");
  assert.deepEqual(provider.capabilities.mediaTypes, ["anime"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["shikimori"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["shikimori"]);
  assert.equal("userAgent" in provider, false);
});

test("shikimoriProvider searches anime by title", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/api/animes": [
        {
          id: 1,
          name: "Cowboy Bebop",
          russian: "Ковбой Бибоп",
          image: {
            original: "/system/animes/original/1.jpg",
            preview: "/system/animes/preview/1.jpg",
          },
          kind: "tv",
          score: "8.75",
          status: "released",
          episodes: 26,
          aired_on: "1998-04-03",
        },
      ],
    }),
  });

  const results = await provider.search({ title: "Cowboy Bebop", type: "anime" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "shikimori");
  assert.equal(results[0]?.item.type, "anime");
  assert.equal(results[0]?.item.title, "Ковбой Бибоп");
  assert.equal(results[0]?.item.originalTitle, "Cowboy Bebop");
  assert.equal(results[0]?.item.year, 1998);
  assert.equal(results[0]?.item.ids?.shikimori, "1");
  assert.equal(results[0]?.item.poster?.url, "https://shikimori.one/system/animes/original/1.jpg");
  assert.equal(results[0]?.item.ratings?.[0]?.source, "shikimori");
  assert.equal(results[0]?.source?.url, "https://shikimori.one/animes/1");
  assert.equal(results[0]?.confidence, 1);
  assert.equal(requests[0]?.path, "/api/animes");
  assert.equal(requests[0]?.params.get("search"), "Cowboy Bebop");
  assert.equal(requests[0]?.params.get("kind"), "tv,movie,ova,ona,special,music");
  assert.equal(requests[0]?.params.get("censored"), "false");
  assert.equal(requests[0]?.userAgent, "MediaEngineTest/0.0.0");
});

test("shikimoriProvider ignores non-anime search queries", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {}),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.deepEqual(results, []);
  assert.equal(requests.length, 0);
});

test("shikimoriProvider searches by Shikimori ID through details endpoint", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/api/animes/1": {
        id: 1,
        name: "Cowboy Bebop",
        russian: "Ковбой Бибоп",
        score: "8.75",
        aired_on: "1998-04-03",
        myanimelist_id: 1,
      },
      "/api/animes/1/roles": [],
      "/api/animes/1/screenshots": [],
    }),
  });

  const results = await provider.search({ ids: { shikimori: "1" }, type: "anime" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.item.ids?.shikimori, "1");
  assert.equal(results[0]?.item.ids?.myAnimeList, "1");
  assert.equal(results[0]?.confidence, 1);
  assert.equal(requests[0]?.path, "/api/animes/1");
});

test("shikimoriProvider maps anime details", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/api/animes/1": {
        id: 1,
        name: "Cowboy Bebop",
        russian: "Ковбой Бибоп",
        english: ["Cowboy Bebop"],
        japanese: ["カウボーイビバップ"],
        synonyms: ["COWBOY BEBOP"],
        image: {
          original: "/system/animes/original/1.jpg",
        },
        kind: "tv",
        score: "8.75",
        status: "released",
        episodes: 26,
        aired_on: "1998-04-03",
        released_on: "1999-04-24",
        duration: 24,
        rating: "r_plus",
        description: "In the year 2071, bounty hunters travel through space.",
        description_source: "A short source description.",
        myanimelist_id: 1,
        rates_scores_stats: [
          { name: 10, value: 1200 },
          { name: 9, value: 800 },
        ],
        genres: [
          { id: 1, name: "Action", russian: "Экшен", kind: "anime" },
          { id: 24, name: "Sci-Fi", russian: "Фантастика", kind: "anime" },
        ],
      },
      "/api/animes/1/roles": [
        {
          roles: ["Main"],
          character: {
            id: 2,
            name: "Spike Spiegel",
            russian: "Спайк Шпигель",
            image: { original: "/system/characters/original/2.jpg" },
          },
          person: null,
        },
        {
          roles: ["Director"],
          character: null,
          person: {
            id: 3,
            name: "Shinichiro Watanabe",
            russian: "Синъитиро Ватанабэ",
            image: { original: "/system/people/original/3.jpg" },
          },
        },
      ],
      "/api/animes/1/screenshots": [
        {
          original: "/system/screenshots/original/1.jpg",
          preview: "/system/screenshots/x332/1.jpg",
        },
      ],
    }),
  });

  const result = await provider.getDetails?.({ ids: { shikimori: "1" }, type: "anime" }, {});

  assert.equal(result?.provider, "shikimori");
  assert.equal(result?.details.type, "anime");
  assert.equal(result?.details.title, "Ковбой Бибоп");
  assert.equal(result?.details.originalTitle, "Cowboy Bebop");
  assert.equal(result?.details.ids?.shikimori, "1");
  assert.equal(result?.details.ids?.myAnimeList, "1");
  assert.equal(result?.details.status, "ended");
  assert.equal(result?.details.animeKind, "tv");
  assert.equal(result?.details.runtimeMinutes, 24);
  assert.equal(result?.details.episodesCount, 26);
  assert.equal(result?.details.episodes?.[25]?.episodeNumber, 26);
  assert.equal(result?.details.genres?.[0]?.name, "Экшен");
  assert.equal(result?.details.ratings?.[0]?.votes, 2000);
  assert.equal(result?.details.images?.length, 2);
  assert.equal(result?.details.persons?.[0]?.roles[0], "voice_actor");
  assert.equal(result?.details.persons?.[1]?.roles[0], "director");
  assert.equal(result?.details.sourceProviders?.[0]?.url, "https://shikimori.one/animes/1");
  assert.equal(result?.details.alternativeTitles?.includes("カウボーイビバップ"), true);
});

test("shikimoriProvider omits unsupported details status labels", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/api/animes/1": {
        id: 1,
        name: "Unknown Status Anime",
        status: "paused",
      },
      "/api/animes/1/roles": [],
      "/api/animes/1/screenshots": [],
    }),
  });

  const result = await provider.getDetails?.({ ids: { shikimori: "1" }, type: "anime" }, {});

  assert.equal(result?.details.status, undefined);
});

test("shikimoriProvider keeps core details when optional roles and screenshots fail", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/api/animes/1": {
        id: 1,
        name: "Cowboy Bebop",
        russian: "Ковбой Бибоп",
        score: "8.75",
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { shikimori: "1" }, type: "anime" }, {});

  assert.equal(result?.details.title, "Ковбой Бибоп");
  assert.equal(result?.details.persons, undefined);
  assert.equal(result?.details.images, undefined);
});

test("shikimoriProvider maps HTTP failures through provider errors", async () => {
  const provider = createProvider({
    fetch: async () => new Response("rate limited", { status: 429 }),
  });

  await assert.rejects(() => provider.search({ title: "Cowboy Bebop", type: "anime" }, {}), {
    name: "ProviderError",
    code: "PROVIDER_RATE_LIMITED",
    retryable: true,
  });
});

interface RequestRecord {
  path: string;
  params: URLSearchParams;
  userAgent: string | null;
}

type JsonByPath = Record<string, unknown>;

function createProvider(
  overrides: Partial<ShikimoriProviderOptions>,
): ReturnType<typeof shikimoriProvider> {
  return shikimoriProvider({
    userAgent: "MediaEngineTest/0.0.0",
    ...overrides,
  });
}

function createMockFetch(
  requests: RequestRecord[],
  responses: JsonByPath,
): ShikimoriProviderOptions["fetch"] {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      userAgent: new Headers(init?.headers).get("user-agent"),
    });

    const response = responses[url.pathname];

    if (response === undefined) {
      throw new ProviderError({
        provider: "shikimori",
        code: "PROVIDER_INVALID_RESPONSE",
        message: `Unexpected test URL: ${url.toString()}`,
        retryable: false,
      });
    }

    return Response.json(response);
  };
}
