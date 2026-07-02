import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { tmdbProvider, type TmdbProviderOptions } from "./index.js";

test("tmdbProvider exposes safe metadata capabilities", () => {
  const provider = tmdbProvider({
    apiKey: "secret-token",
  });

  assert.equal(provider.name, "tmdb");
  assert.equal(provider.kind, "metadata");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb", "tmdb"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb", "tmdb"]);
  assert.equal("apiKey" in provider, false);
});

test("tmdbProvider requires apiKey", () => {
  assert.throws(
    () =>
      tmdbProvider({
        apiKey: " ",
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_UNAUTHORIZED",
      retryable: false,
    },
  );
});

test("tmdbProvider searches movies by title", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/search/movie": {
        results: [
          {
            id: 157336,
            title: "Interstellar",
            original_title: "Interstellar",
            overview: "A team travels through a wormhole in space.",
            release_date: "2014-11-07",
            poster_path: "/poster.jpg",
            backdrop_path: "/backdrop.jpg",
            genre_ids: [878, 18],
            vote_average: 8.4,
            vote_count: 37000,
          },
        ],
      },
    }),
  });

  const results = await provider.search(
    { title: "Interstellar", type: "movie", year: 2014, language: "ru-RU" },
    {},
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "tmdb");
  assert.equal(results[0]?.item.title, "Interstellar");
  assert.equal(results[0]?.item.type, "movie");
  assert.equal(results[0]?.item.year, 2014);
  assert.equal(results[0]?.item.ids?.tmdb, "157336");
  assert.equal(results[0]?.item.poster?.url, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(results[0]?.source?.url, "https://www.themoviedb.org/movie/157336");
  assert.equal(results[0]?.confidence, 0.9);
  assert.equal(requests[0]?.path, "/search/movie");
  assert.equal(requests[0]?.params.get("query"), "Interstellar");
  assert.equal(requests[0]?.params.get("primary_release_year"), "2014");
  assert.equal(requests[0]?.params.get("language"), "ru-RU");
  assert.equal(requests[0]?.authorization, "Bearer test-token");
});

test("tmdbProvider searches series by title", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/search/tv": {
        results: [
          {
            id: 1396,
            name: "Breaking Bad",
            original_name: "Breaking Bad",
            overview: "A chemistry teacher turns to crime.",
            first_air_date: "2008-01-20",
            poster_path: "/series-poster.jpg",
            vote_average: 8.9,
            vote_count: 16000,
          },
        ],
      },
    }),
  });

  const results = await provider.search({ title: "Breaking Bad", type: "series" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.item.type, "series");
  assert.equal(results[0]?.item.title, "Breaking Bad");
  assert.equal(results[0]?.item.ids?.tmdb, "1396");
  assert.equal(results[0]?.source?.url, "https://www.themoviedb.org/tv/1396");
  assert.equal(requests[0]?.path, "/search/tv");
});

test("tmdbProvider searches by IMDb ID through find endpoint", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/find/tt0816692": {
        movie_results: [
          {
            id: 157336,
            title: "Interstellar",
            release_date: "2014-11-07",
          },
        ],
        tv_results: [],
      },
    }),
  });

  const results = await provider.search({ ids: { imdb: "tt0816692" } }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.item.ids?.imdb, "tt0816692");
  assert.equal(results[0]?.item.ids?.tmdb, "157336");
  assert.equal(results[0]?.confidence, 1);
  assert.equal(requests[0]?.path, "/find/tt0816692");
  assert.equal(requests[0]?.params.get("external_source"), "imdb_id");
});

test("tmdbProvider maps movie details", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/movie/157336": {
        id: 157336,
        title: "Interstellar",
        original_title: "Interstellar",
        overview: "A team travels through a wormhole in space.",
        release_date: "2014-11-07",
        runtime: 169,
        status: "Released",
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        vote_average: 8.4,
        vote_count: 37000,
        budget: 165000000,
        revenue: 733000000,
        original_language: "en",
        production_countries: [{ iso_3166_1: "US", name: "United States of America" }],
        genres: [
          { id: 878, name: "Science Fiction" },
          { id: 18, name: "Drama" },
        ],
        external_ids: {
          imdb_id: "tt0816692",
        },
        credits: {
          cast: [
            {
              id: 10297,
              name: "Matthew McConaughey",
              original_name: "Matthew McConaughey",
              character: "Cooper",
              order: 0,
              profile_path: "/person.jpg",
            },
          ],
          crew: [{ id: 525, name: "Christopher Nolan", job: "Director" }],
        },
        images: {
          posters: [{ file_path: "/poster-alt.jpg", width: 1000, height: 1500, iso_639_1: "en" }],
          backdrops: [{ file_path: "/backdrop-alt.jpg", width: 1920, height: 1080 }],
        },
        alternative_titles: {
          titles: [{ title: "Interstellar: The IMAX Experience" }],
        },
        belongs_to_collection: {
          id: 1,
          name: "Interstellar Collection",
          poster_path: "/collection-poster.jpg",
          backdrop_path: "/collection-backdrop.jpg",
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { tmdb: "157336" }, type: "movie" }, {});

  assert.equal(result?.provider, "tmdb");
  assert.equal(result?.details.type, "movie");
  assert.equal(result?.details.title, "Interstellar");
  assert.equal(result?.details.ids?.imdb, "tt0816692");
  assert.equal(result?.details.genres?.[0]?.name, "Science Fiction");
  assert.equal(result?.details.status, "released");
  assert.equal(result?.details.runtimeMinutes, 169);
  assert.equal(result?.details.images?.length, 2);
  assert.equal(result?.details.persons?.[0]?.roles[0], "actor");
  assert.equal(result?.details.persons?.[1]?.roles[0], "director");
  assert.equal(
    result?.details.sourceProviders?.[0]?.url,
    "https://www.themoviedb.org/movie/157336",
  );
  assert.equal(result?.details.alternativeTitles?.[0], "Interstellar: The IMAX Experience");
  assert.equal(
    result?.details.type === "movie" ? result.details.budget?.amount : undefined,
    165000000,
  );
  assert.equal(
    result?.details.type === "movie" ? result.details.collection?.title : undefined,
    "Interstellar Collection",
  );
});

test("tmdbProvider maps series details", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/tv/1396": {
        id: 1396,
        name: "Breaking Bad",
        original_name: "Breaking Bad",
        overview: "A chemistry teacher turns to crime.",
        first_air_date: "2008-01-20",
        episode_run_time: [47],
        status: "Ended",
        number_of_episodes: 62,
        number_of_seasons: 5,
        origin_country: ["US"],
        original_language: "en",
        genres: [{ id: 80, name: "Crime" }],
        external_ids: {
          imdb_id: "tt0903747",
        },
        seasons: [
          {
            id: 3572,
            season_number: 1,
            name: "Season 1",
            overview: "The first season.",
            episode_count: 7,
            air_date: "2008-01-20",
            poster_path: "/season-poster.jpg",
          },
        ],
        alternative_titles: {
          results: [{ title: "Во все тяжкие" }],
        },
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { tmdb: "1396" }, type: "series" }, {});

  assert.equal(result?.details.type, "series");
  assert.equal(result?.details.ids?.imdb, "tt0903747");
  assert.equal(result?.details.status, "ended");
  assert.equal(result?.details.runtimeMinutes, 47);
  assert.equal(result?.details.type === "series" ? result.details.seasonsCount : undefined, 5);
  assert.equal(result?.details.type === "series" ? result.details.episodesCount : undefined, 62);
  assert.equal(
    result?.details.type === "series" ? result.details.seasons?.[0]?.episodesCount : undefined,
    7,
  );
  assert.equal(result?.details.alternativeTitles?.[0], "Во все тяжкие");
});

test("tmdbProvider maps HTTP failures through provider errors", async () => {
  const provider = createProvider({
    fetch: async () => new Response("unauthorized", { status: 401 }),
  });

  await assert.rejects(() => provider.search({ title: "Interstellar", type: "movie" }, {}), {
    name: "ProviderError",
    code: "PROVIDER_UNAUTHORIZED",
    retryable: false,
  });
});

interface RequestRecord {
  path: string;
  params: URLSearchParams;
  authorization: string | null;
}

type JsonByPath = Record<string, unknown>;

function createProvider(overrides: Partial<TmdbProviderOptions>): ReturnType<typeof tmdbProvider> {
  return tmdbProvider({
    apiKey: "test-token",
    ...overrides,
  });
}

function createMockFetch(
  requests: RequestRecord[],
  responses: JsonByPath,
): TmdbProviderOptions["fetch"] {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname.replace("/3", ""),
      params: url.searchParams,
      authorization: new Headers(init?.headers).get("authorization"),
    });

    const response = responses[url.pathname.replace("/3", "")];

    if (response === undefined) {
      throw new ProviderError({
        provider: "tmdb",
        code: "PROVIDER_INVALID_RESPONSE",
        message: `Unexpected test URL: ${url.toString()}`,
        retryable: false,
      });
    }

    return Response.json(response);
  };
}
