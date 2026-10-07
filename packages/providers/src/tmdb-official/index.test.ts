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
