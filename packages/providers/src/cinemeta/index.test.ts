import assert from "node:assert/strict";
import { test } from "node:test";

import { cinemetaProvider, type CinemetaProviderOptions } from "./index.js";

test("cinemetaProvider exposes no-token movie and series capabilities", () => {
  const provider = cinemetaProvider();

  assert.equal(provider.name, "cinemeta");
  assert.equal(provider.kind, "metadata");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb"]);
});

test("cinemetaProvider searches movies by title", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/catalog/movie/top/search=Interstellar.json": {
        metas: [interstellarMeta()],
      },
      "/catalog/series/top/search=Interstellar.json": {
        metas: [],
      },
    }),
  });

  const results = await provider.search({ title: "Interstellar" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "cinemeta");
  assert.equal(results[0]?.item.title, "Interstellar");
  assert.equal(results[0]?.item.type, "movie");
  assert.equal(results[0]?.item.ids?.imdb, "tt0816692");
  assert.equal(results[0]?.item.ids?.tmdb, "157336");
  assert.equal(results[0]?.item.ratings?.[0]?.value, 8.7);
  assert.equal(results[0]?.confidence, 0.95);
  assert.equal(requests[0]?.path, "/catalog/movie/top/search=Interstellar.json");
});

test("cinemetaProvider enriches sparse search results with meta ratings", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/catalog/series/top/search=game%20of.json": {
        metas: [
          {
            id: "tt0944947",
            imdb_id: "tt0944947",
            type: "series",
            name: "Game of Thrones",
            releaseInfo: "2011-2019",
          },
        ],
      },
      "/meta/series/tt0944947.json": {
        meta: {
          id: "tt0944947",
          imdb_id: "tt0944947",
          type: "series",
          name: "Game of Thrones",
          releaseInfo: "2011-2019",
          description: "Nine noble families fight for control over Westeros.",
          imdbRating: "9.2",
          genre: ["Action", "Adventure", "Drama"],
        },
      },
    }),
  });

  const results = await provider.search({ title: "game of", type: "series" }, {});

  assert.equal(results[0]?.item.title, "Game of Thrones");
  assert.equal(results[0]?.item.ratings?.[0]?.source, "imdb");
  assert.equal(results[0]?.item.ratings?.[0]?.value, 9.2);
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/catalog/series/top/search=game%20of.json", "/meta/series/tt0944947.json"],
  );
});

test("cinemetaProvider applies search limit per media type for any search", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/catalog/movie/top/search=game%20of.json": {
        metas: [
          {
            id: "tt15397918",
            imdb_id: "tt15397918",
            type: "movie",
            name: "Game of Love",
            releaseInfo: "2022",
            imdbRating: "3.3",
          },
        ],
      },
      "/catalog/series/top/search=game%20of.json": {
        metas: [
          {
            id: "tt0944947",
            imdb_id: "tt0944947",
            type: "series",
            name: "Game of Thrones",
            releaseInfo: "2011-2019",
            imdbRating: "9.2",
          },
        ],
      },
    }),
  });

  const results = await provider.search({ title: "game of", limit: 1 }, {});

  assert.deepEqual(results.map((result) => result.item.title).sort(), [
    "Game of Love",
    "Game of Thrones",
  ]);
});

test("cinemetaProvider loads movie details by IMDb ID", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/meta/movie/tt0816692.json": {
        meta: {
          ...interstellarMeta(),
          runtime: "169 min",
          country: "United States, United Kingdom",
          director: ["Christopher Nolan"],
          writer: ["Jonathan Nolan", "Christopher Nolan"],
          cast: ["Matthew McConaughey", "Anne Hathaway"],
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(result?.provider, "cinemeta");
  assert.equal(result?.details.title, "Interstellar");
  assert.equal(result?.details.runtimeMinutes, 169);
  assert.equal(result?.details.persons?.[0]?.roles[0], "director");
});

test("cinemetaProvider maps series status and episode counters", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/meta/series/tt0944947.json": {
        meta: {
          id: "tt0944947",
          imdb_id: "tt0944947",
          type: "series",
          name: "Game of Thrones",
          releaseInfo: "2011-2019",
          imdbRating: "9.2",
          status: "Ended",
          videos: [
            { season: 0, number: 1 },
            { season: 1, number: 1 },
            { season: 1, number: 2 },
            { season: 2, number: 1 },
          ],
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0944947" }, type: "series" }, {});

  assert.equal(result?.details.type, "series");

  if (!result || result.details.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(result.details.status, "ended");
  assert.equal(result.details.episodesCount, 3);
  assert.equal(result.details.seasonsCount, 2);
});

function createProvider(options: Partial<CinemetaProviderOptions>) {
  return cinemetaProvider({
    baseUrl: "https://cinemeta.test",
    ...options,
  });
}

function interstellarMeta() {
  return {
    id: "tt0816692",
    imdb_id: "tt0816692",
    type: "movie",
    name: "Interstellar",
    poster: "https://example.test/poster.jpg",
    background: "https://example.test/background.jpg",
    releaseInfo: "2014",
    description: "A team travels through a wormhole in space.",
    imdbRating: "8.7",
    moviedb_id: 157336,
    genre: ["Adventure", "Drama", "Sci-Fi"],
  };
}

interface RequestRecord {
  path: string;
}

function createMockFetch(requests: RequestRecord[], responses: Record<string, unknown>) {
  return async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname });

    return Response.json(responses[url.pathname] ?? { metas: [] });
  };
}
