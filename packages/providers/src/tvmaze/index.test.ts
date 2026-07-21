import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngine } from "@media-engine/core";
import { tvMazeProvider, type TvMazeProviderOptions } from "./index.js";

test("tvMazeProvider validates bounded options", () => {
  assert.throws(() => tvMazeProvider({ searchLimit: 0 }), /TVmaze searchLimit/);
  assert.throws(() => tvMazeProvider({ searchLimit: 101 }), /TVmaze searchLimit/);
  assert.throws(() => tvMazeProvider({ aliasLimit: -1 }), /TVmaze aliasLimit/);
  assert.throws(() => tvMazeProvider({ aliasLimit: 101 }), /TVmaze aliasLimit/);
});

test("tvMazeProvider exposes fallback-only no-token series capabilities", () => {
  const provider = tvMazeProvider();

  assert.equal(provider.name, "tvmaze");
  assert.equal(provider.kind, "metadata");
  assert.equal(provider.searchPosterMatchesDetails, true);
  assert.deepEqual(provider.capabilities.mediaTypes, ["series"]);
  assert.equal(provider.capabilities.searchEnrichment, false);
  assert.equal(provider.capabilities.search.titleDiscovery, "fallback");
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb"]);
});

test("tvMazeProvider maps strong series identities from title search", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    searchLimit: 1,
    fetch: createMockFetch(requests, {
      search: [
        { score: 1.4, show: gameOfThronesShow() },
        { score: 1, show: { id: 99, name: "No IMDb", externals: {} } },
      ],
    }),
  });

  const results = await provider.search(
    { title: "game of thrones", type: "series", year: 2011, limit: 1 },
    { debug: true },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "tvmaze");
  assert.equal(results[0]?.item.id, "tvmaze-series-82");
  assert.equal(results[0]?.item.title, "Game of Thrones");
  assert.equal(results[0]?.item.year, 2011);
  assert.equal(results[0]?.item.description?.includes("<"), false);
  assert.equal(results[0]?.item.poster?.source, "tvmaze");
  assert.deepEqual(results[0]?.item.ids, { imdb: "tt0944947" });
  assert.deepEqual(results[0]?.item.ratings, [{ source: "tvmaze", value: 8.9, max: 10 }]);
  assert.equal(results[0]?.confidence, 0.9);
  assert.equal(results[0]?.source?.url, "https://www.tvmaze.com/shows/82/game-of-thrones");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "/search/shows");
  assert.equal(requests[0]?.params.get("q"), "game of thrones");
  assert.equal(requests[0]?.userAgent, "MediaEngineTest/0.0.0");
  assert.ok(results[0]?.raw);
});

test("tvMazeProvider confirms an unrelated-script top result through bounded aliases", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    aliasLimit: 2,
    fetch: createMockFetch(requests, {
      search: [{ score: 0.53, show: sopranosShow() }],
      aliases: [{ name: "Клан Сопрано" }, { name: "Die Sopranos" }, { name: "Los Soprano" }],
    }),
  });

  const results = await provider.search({ title: "клан сопрано", type: "series" }, {});

  assert.deepEqual(results[0]?.item.alternativeTitles, ["Клан Сопрано", "Die Sopranos"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.path, "/shows/527/akas");
});

test("tvMazeProvider skips unsupported media types before HTTP work", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({ fetch: createMockFetch(requests, {}) });

  assert.deepEqual(await provider.search({ title: "Dune", type: "movie" }, {}), []);
  assert.deepEqual(await provider.search({ title: "Death Note", type: "anime" }, {}), []);
  assert.deepEqual(requests, []);
});

test("tvMazeProvider maps series details through exact IMDb lookup", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, { lookup: gameOfThronesShow() }),
  });

  const result = await provider.getDetails?.(
    { ids: { imdb: "tt0944947" }, type: "series" },
    { debug: true },
  );

  assert.equal(result?.provider, "tvmaze");
  assert.equal(result?.details.type, "series");
  assert.equal(result?.details.status, "ended");
  assert.equal(result?.details.runtimeMinutes, 61);
  assert.deepEqual(result?.details.countries, ["United States"]);
  assert.equal(result?.details.sourceProviders?.[0]?.provider, "tvmaze");
  assert.equal(result?.confidence, 1);
  assert.ok(result?.raw);
  assert.equal(requests[0]?.path, "/lookup/shows");
  assert.equal(requests[0]?.params.get("imdb"), "tt0944947");
});

test("tvMazeProvider keeps exact IMDb search results compact", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], { lookup: gameOfThronesShow() }),
  });

  const results = await provider.search({ ids: { imdb: "tt0944947" }, type: "series" }, {});
  const item = results[0]?.item as MediaItemWithDetailsFields | undefined;

  assert.equal(item?.title, "Game of Thrones");
  assert.equal(item?.status, undefined);
  assert.equal(item?.runtimeMinutes, undefined);
  assert.equal(item?.sourceProviders, undefined);
});

test("tvMazeProvider returns null for a confirmed missing IMDb identity", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], { lookupStatus: 404 }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0000000" } }, {});

  assert.equal(result, null);
});

test("MediaEngine uses TVmaze as localized fallback identity discovery", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      search: [{ score: 0.53, show: sopranosShow() }],
      aliases: [{ name: "Клан Сопрано" }],
    }),
  });
  const engine = new MediaEngine({ providers: [provider] });

  const response = await engine.search({ title: "клан сопрано", type: "series" });

  assert.equal(response.results[0]?.item.title, "Клан Сопрано");
  assert.equal(response.results[0]?.item.ids?.imdb, "tt0141842");
  assert.deepEqual(response.meta.providers.requested, ["tvmaze"]);
  assert.deepEqual(response.meta.providers.failed, []);
});

function createProvider(options: Partial<TvMazeProviderOptions>) {
  return tvMazeProvider({
    baseUrl: "https://tvmaze.test",
    userAgent: "MediaEngineTest/0.0.0",
    ...options,
  });
}

function gameOfThronesShow() {
  return {
    id: 82,
    url: "https://www.tvmaze.com/shows/82/game-of-thrones",
    name: "Game of Thrones",
    type: "Scripted",
    language: "English",
    genres: ["Drama", "Adventure", "Fantasy"],
    status: "Ended",
    runtime: 60,
    averageRuntime: 61,
    premiered: "2011-04-17",
    ended: "2019-05-19",
    summary: "<p>A battle for the <b>Iron Throne</b> &amp; the realm.</p>",
    rating: { average: 8.9 },
    externals: { imdb: "tt0944947" },
    image: {
      medium: "https://static.tvmaze.com/medium.jpg",
      original: "https://static.tvmaze.com/original.jpg",
    },
    network: { country: { name: "United States" } },
  };
}

function sopranosShow() {
  return {
    id: 527,
    url: "https://www.tvmaze.com/shows/527/the-sopranos",
    name: "The Sopranos",
    premiered: "1999-01-10",
    externals: { imdb: "tt0141842" },
  };
}

interface RequestRecord {
  path: string;
  params: URLSearchParams;
  userAgent: string | null;
}

interface MediaItemWithDetailsFields {
  title: string;
  status?: unknown;
  runtimeMinutes?: unknown;
  sourceProviders?: unknown;
}

function createMockFetch(
  requests: RequestRecord[],
  responses: {
    search?: unknown;
    aliases?: unknown;
    lookup?: unknown;
    lookupStatus?: number;
  },
) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      userAgent: new Headers(init?.headers).get("user-agent"),
    });

    if (url.pathname === "/search/shows") {
      return Response.json(responses.search ?? []);
    }

    if (/^\/shows\/\d+\/akas$/.test(url.pathname)) {
      return Response.json(responses.aliases ?? []);
    }

    if (url.pathname === "/lookup/shows") {
      return responses.lookupStatus
        ? new Response("null", { status: responses.lookupStatus })
        : Response.json(responses.lookup ?? null);
    }

    return new Response("Not found", { status: 404 });
  };
}
