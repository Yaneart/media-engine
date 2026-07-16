import assert from "node:assert/strict";
import { test } from "node:test";

import { cinemetaProvider, type CinemetaProviderOptions } from "./index.js";

test("cinemetaProvider validates bounded numeric options", () => {
  assert.throws(() => cinemetaProvider({ searchLimit: 0 }), /Cinemeta searchLimit/);
  assert.throws(() => cinemetaProvider({ imageLimit: 101 }), /Cinemeta imageLimit/);
});

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

test("cinemetaProvider does not block typed title search on optional meta enrichment", async () => {
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
  assert.equal(results[0]?.item.ratings, undefined);
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/catalog/series/top/search=game%20of.json"],
  );
});

test("cinemetaProvider skips enrichment for short broad title-only search", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/catalog/movie/top/search=one.json": {
        metas: [
          {
            id: "tt1234567",
            imdb_id: "tt1234567",
            type: "movie",
            name: "One Movie",
            releaseInfo: "2020",
          },
        ],
      },
      "/catalog/series/top/search=one.json": {
        metas: [
          {
            id: "tt7654321",
            imdb_id: "tt7654321",
            type: "series",
            name: "One Series",
            releaseInfo: "2021",
          },
        ],
      },
      "/meta/movie/tt1234567.json": {
        meta: {
          id: "tt1234567",
          imdb_id: "tt1234567",
          type: "movie",
          name: "One Movie",
          imdbRating: "8.0",
        },
      },
      "/meta/series/tt7654321.json": {
        meta: {
          id: "tt7654321",
          imdb_id: "tt7654321",
          type: "series",
          name: "One Series",
          imdbRating: "8.5",
        },
      },
    }),
  });

  const results = await provider.search({ title: "one" }, {});

  assert.deepEqual(results.map((result) => result.item.title).sort(), ["One Movie", "One Series"]);
  assert.deepEqual(
    requests.map((request) => request.path),
    ["/catalog/movie/top/search=one.json", "/catalog/series/top/search=one.json"],
  );
  assert.equal(
    results.some((result) => result.item.ratings?.length),
    false,
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

test("cinemetaProvider resolves an untyped IMDb ID across movie and series in parallel", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/meta/series/tt0944947.json": {
        meta: {
          id: "tt0944947",
          imdb_id: "tt0944947",
          type: "series",
          name: "Game of Thrones",
          releaseInfo: "2011-2019",
          imdbRating: "9.2",
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0944947" } }, {});

  assert.equal(result?.details.type, "series");
  assert.deepEqual(
    requests.map((request) => request.path).sort(),
    ["/meta/movie/tt0944947.json", "/meta/series/tt0944947.json"].sort(),
  );
});

test("cinemetaProvider exposes generic series details for an anime IMDb id", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/meta/series/tt0388629.json": {
        meta: {
          id: "tt0388629",
          imdb_id: "tt0388629",
          type: "series",
          name: "One Piece",
          releaseInfo: "1999-",
          description: "International catalog description.",
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0388629" }, type: "anime" }, {});

  assert.equal(result?.details.type, "series");
  assert.equal(result?.details.description, "International catalog description.");
});

test("cinemetaProvider limits heavy details arrays", async () => {
  const provider = createProvider({
    imageLimit: 1,
    personLimit: 2,
    fetch: createMockFetch([], {
      "/meta/movie/tt0816692.json": {
        meta: {
          ...interstellarMeta(),
          director: ["Christopher Nolan"],
          writer: ["Jonathan Nolan"],
          cast: ["Matthew McConaughey", "Anne Hathaway"],
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(result?.details.images?.length, 1);
  assert.equal(result?.details.persons?.length, 2);
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

test("cinemetaProvider distinguishes planned, production, and returning statuses", async () => {
  const cases = [
    ["Planned", "announced"],
    ["Pilot", "announced"],
    ["In Production", "in_production"],
    ["Returning Series", "ongoing"],
  ] as const;

  for (const [providerStatus, expectedStatus] of cases) {
    const provider = createProvider({
      fetch: createMockFetch([], {
        "/meta/series/tt-test.json": {
          meta: {
            id: "tt-test",
            imdb_id: "tt-test",
            type: "series",
            name: "Status fixture",
            status: providerStatus,
          },
        },
      }),
    });
    const result = await provider.getDetails?.({ ids: { imdb: "tt-test" }, type: "series" }, {});

    assert.equal(result?.details.status, expectedStatus);
  }
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
