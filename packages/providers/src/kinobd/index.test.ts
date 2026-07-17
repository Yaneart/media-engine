import assert from "node:assert/strict";
import { test } from "node:test";

import { kinobdProvider, type KinoBdProviderOptions } from "./index.js";

test("kinobdProvider validates bounded numeric options", () => {
  assert.throws(() => kinobdProvider({ searchLimit: 0 }), /KinoBD searchLimit/);
  assert.throws(() => kinobdProvider({ personLimit: 101 }), /KinoBD personLimit/);
});

test("kinobdProvider exposes no-token movie and series capabilities", () => {
  const provider = kinobdProvider();

  assert.equal(provider.name, "kinobd");
  assert.equal(provider.kind, "metadata");
  assert.equal(provider.searchPosterMatchesDetails, true);
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb", "kinopoisk"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb", "kinopoisk"]);
});

test("kinobdProvider searches and ranks exact popular movies by title", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "/api/films/search/title": {
        data: [interstellarShort(), interstellarMovie()],
      },
    }),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.equal(results.length, 2);
  assert.equal(results[0]?.provider, "kinobd");
  assert.equal(results[0]?.item.title, "Интерстеллар");
  assert.equal(results[0]?.item.originalTitle, "Interstellar");
  assert.deepEqual(results[0]?.item.alternativeTitles, ["Interstellar"]);
  assert.equal(results[0]?.item.ids?.kinopoisk, "258687");
  assert.equal(results[0]?.item.ids?.imdb, "tt0816692");
  assert.equal(results[0]?.item.ratings?.[0]?.source, "kinopoisk");
  assert.equal(requests[0]?.path, "/api/films/search/title");
  assert.equal(requests[0]?.query.get("q"), "Interstellar");
});

test("kinobdProvider loads details by Kinopoisk ID", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "/api/films/search/kp_id": {
        data: [
          {
            ...interstellarMovie(),
            persons: [
              {
                id: 383245,
                name_english: "Christopher Nolan",
                name_russian: "Кристофер Нолан",
                kinopoisk_id: 41477,
                profession: { profession_id: "director" },
              },
            ],
            genres: [{ id: 14, name_ru: "фантастика" }],
            countries: [{ name_ru: "США" }],
            images: [
              { type: "kadr", width: 360, height: 203, src: "https://example.test/still.jpg" },
            ],
          },
        ],
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { kinopoisk: "258687" }, type: "movie" }, {});

  assert.equal(result?.provider, "kinobd");
  assert.equal(result?.details.title, "Интерстеллар");
  assert.equal(result?.details.runtimeMinutes, 169);
  assert.equal(result?.details.genres?.[0]?.name, "фантастика");
  assert.equal(result?.details.persons?.[0]?.roles[0], "director");
  assert.equal(
    result?.details.images?.some((image) => image.type === "still"),
    true,
  );
});

test("kinobdProvider limits heavy details arrays", async () => {
  const provider = createProvider({
    imageLimit: 2,
    personLimit: 1,
    fetch: createMockFetch([], {
      "/api/films/search/kp_id": {
        data: [
          {
            ...interstellarMovie(),
            persons: [
              {
                id: 1,
                name_russian: "Первый актер",
                profession: { profession_id: "actor" },
              },
              {
                id: 2,
                name_russian: "Второй актер",
                profession: { profession_id: "actor" },
              },
            ],
            images: [
              { type: "kadr", src: "https://example.test/still-1.jpg" },
              { type: "kadr", src: "https://example.test/still-2.jpg" },
            ],
          },
        ],
      },
    }),
  });

  const result = await provider.getDetails?.({ ids: { kinopoisk: "258687" }, type: "movie" }, {});

  assert.equal(result?.details.persons?.length, 1);
  assert.equal(result?.details.images?.length, 2);
});

function createProvider(options: Partial<KinoBdProviderOptions>) {
  return kinobdProvider({
    baseUrl: "https://kinobd.test",
    ...options,
  });
}

function interstellarMovie() {
  return {
    id: 94666,
    kinopoisk_id: 258687,
    imdb_id: "tt0816692",
    tmdb_id: 157336,
    name_original: "Interstellar",
    name_russian: "Интерстеллар",
    year: "2014",
    rating_kp: 8.7,
    rating_kp_count: 1160804,
    rating_imdb: 8.7,
    rating_imdb_count: 2500000,
    description: "Когда засуха приводит человечество к кризису.",
    country_ru: "США, Великобритания",
    type: "film",
    time_minutes: 169,
    big_poster: "https://example.test/interstellar.jpg",
    popular_rate: 986255,
  };
}

function interstellarShort() {
  return {
    id: 691735,
    kinopoisk_id: 1363798,
    imdb_id: "tt4172224",
    name_original: "Interstellar: Nolan's Odyssey",
    name_russian: "Interstellar: Nolan's Odyssey",
    year: "2014",
    rating_kp: 8.2,
    rating_kp_count: 326,
    type: "film",
    time_minutes: 23,
    big_poster: "https://example.test/short.jpg",
    popular_rate: 0,
  };
}

interface RequestRecord {
  path: string;
  query: URLSearchParams;
}

function createMockFetch(requests: RequestRecord[], responses: Record<string, unknown>) {
  return async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, query: url.searchParams });

    return Response.json(responses[url.pathname] ?? { data: [] });
  };
}
