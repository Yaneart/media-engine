import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@media-engine/core";
import { tmdbOfficialProvider } from "./index.js";

const movie = {
  id: 157336,
  imdb_id: "tt0816692",
  title: "Интерстеллар",
  original_title: "Interstellar",
  overview: "Исследователи отправляются сквозь червоточину.",
  poster_path: "/poster.jpg",
  backdrop_path: "/backdrop.jpg",
  release_date: "2014-11-05",
  genres: [{ id: 878, name: "Фантастика" }],
  vote_average: 8.5,
  vote_count: 100,
  status: "Released",
  runtime: 169,
  external_ids: { imdb_id: "tt0816692" },
  alternative_titles: { results: [{ title: "Интерстеллар 2014" }] },
};

test("tmdbOfficialProvider maps one coherent localized details response", async () => {
  let requestedUrl: URL | undefined;
  const provider = tmdbOfficialProvider({
    apiKey: "server-secret",
    fetch: async (input) => {
      requestedUrl = new URL(input);
      return Response.json(movie);
    },
  });

  const result = await provider.getDetails?.(
    { type: "movie", ids: { tmdb: "157336", imdb: "tt0816692" } },
    { language: "ru" },
  );

  assert.equal(result?.details.title, "Интерстеллар");
  assert.equal(result?.details.description, movie.overview);
  assert.equal(result?.details.poster?.url, "https://image.tmdb.org/t/p/original/poster.jpg");
  assert.equal(result?.details.backdrop?.url, "https://image.tmdb.org/t/p/original/backdrop.jpg");
  assert.deepEqual(result?.details.ids, { tmdb: "157336", imdb: "tt0816692" });
  assert.equal(requestedUrl?.searchParams.get("language"), "ru-RU");
  assert.equal(
    requestedUrl?.searchParams.get("append_to_response"),
    "external_ids,alternative_titles",
  );
  assert.deepEqual(result?.details.alternativeTitles, ["Интерстеллар 2014"]);
  assert.equal(provider.capabilities.metadataRoute, "primary");
  assert.equal(JSON.stringify(provider).includes("server-secret"), false);
});

test("tmdbOfficialProvider rejects contradictory identities and maps 404 to a miss", async () => {
  const mismatch = tmdbOfficialProvider({
    apiKey: "secret",
    fetch: async () => Response.json(movie),
  });
  assert.equal(
    await mismatch.getDetails?.({ type: "movie", ids: { tmdb: "157336", imdb: "tt0000001" } }, {}),
    null,
  );

  const missing = tmdbOfficialProvider({
    apiKey: "secret",
    fetch: async () => Response.json({ status_code: 34 }, { status: 404 }),
  });
  assert.equal(await missing.getDetails?.({ type: "movie", ids: { tmdb: "999999" } }, {}), null);
});

test("tmdbOfficialProvider keeps missing configuration behind a safe provider error", async () => {
  const provider = tmdbOfficialProvider();
  await assert.rejects(
    provider.getDetails!({ type: "movie", ids: { tmdb: "157336" } }, {}),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_UNAUTHORIZED" &&
      !error.message.includes("api_key"),
  );
});

test("tmdbOfficialProvider discovers filtered movie cards without per-item detail requests", async () => {
  const requestedUrls: URL[] = [];
  const provider = tmdbOfficialProvider({
    apiKey: "secret",
    fetch: async (input) => {
      const url = new URL(input);
      requestedUrls.push(url);
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        results: [
          {
            id: 1000 + page,
            title: `Фильм ${page}`,
            original_title: `Movie ${page}`,
            overview: "Overview",
            poster_path: `/poster-${page}.jpg`,
            backdrop_path: `/backdrop-${page}.jpg`,
            release_date: "2024-03-01",
            genre_ids: [53],
            vote_average: 8.1,
            vote_count: 50,
          },
        ],
      });
    },
  });

  const results = await provider.search(
    { type: "movie", year: 2024, genre: "Thriller", minimumRating: 7, limit: 49 },
    { language: "ru" },
  );

  assert.equal(requestedUrls.length, 3);
  assert.ok(requestedUrls.every((url) => url.pathname === "/3/discover/movie"));
  assert.ok(requestedUrls.every((url) => url.searchParams.get("with_genres") === "53"));
  assert.ok(requestedUrls.every((url) => url.searchParams.get("language") === "ru-RU"));
  assert.ok(requestedUrls.every((url) => url.searchParams.get("primary_release_year") === "2024"));
  assert.ok(requestedUrls.every((url) => url.searchParams.get("vote_average.gte") === "7"));
  assert.equal(results.length, 3);
  assert.equal(results[0]?.item.title, "Фильм 1");
  assert.equal(results[0]?.item.originalTitle, "Movie 1");
  assert.deepEqual(results[0]?.item.ids, { tmdb: "1001" });
  assert.ok(results[0]?.item.genres?.some((genre) => genre.name === "Thriller"));
  assert.deepEqual(provider.capabilities.search.filterDiscovery, [
    "year",
    "genre",
    "minimumRating",
  ]);
});

test("tmdbOfficialProvider leaves unsupported official genres to fallback discovery", async () => {
  let requests = 0;
  const provider = tmdbOfficialProvider({
    apiKey: "secret",
    fetch: async () => {
      requests += 1;
      return Response.json({ results: [] });
    },
  });

  assert.deepEqual(await provider.search({ type: "movie", genre: "Biography" }, {}), []);
  assert.equal(requests, 0);
});
