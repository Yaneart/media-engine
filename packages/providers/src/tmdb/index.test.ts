import assert from "node:assert/strict";
import { test } from "node:test";
import { tmdbProvider } from "./index.js";

test("localized details retain Russian fields and fill only missing fields", async () => {
  const paths: string[] = [];
  const provider = tmdbProvider({
    baseUrl: "https://addon.example",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Response.json({
        meta: path.startsWith("/ru-RU")
          ? {
              id: "tmdb:42",
              imdb_id: "tt1234567",
              type: "movie",
              name: "Русское название",
              description: "",
              genres: ["военный"],
              year: 2024,
            }
          : {
              id: "tmdb:42",
              imdb_id: "tt1234567",
              type: "movie",
              name: "English title",
              description: "Original description",
              genres: ["War"],
              year: 2024,
            },
      });
    },
  });
  const details = (
    await provider.getDetails?.(
      { ids: { imdb: "tt1234567" }, type: "movie", language: "ru" },
      { language: "ru" },
    )
  )?.details;
  assert.equal(details?.title, "Русское название");
  assert.equal(details?.description, "Original description");
  assert.deepEqual(
    details?.genres?.map((genre) => genre.name),
    ["Военные"],
  );
  assert.deepEqual(details?.ids, { tmdb: "42", imdb: "tt1234567" });
  assert.deepEqual(paths, ["/ru-RU/meta/movie/tt1234567.json", "/en-US/meta/movie/tt1234567.json"]);
});

test("War discovery requests the Russian genre and returns localized cards", async () => {
  const paths: string[] = [];
  const provider = tmdbProvider({
    baseUrl: "https://addon.example",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Response.json({
        metas: [
          {
            id: "tmdb:7",
            type: "movie",
            name: "Русский фильм",
            genres: ["военный"],
            description: "Русское описание",
            year: 2024,
            imdbRating: "8.1",
          },
        ],
      });
    },
  });
  const results = await provider.search(
    { type: "movie", genre: "War", year: 2024, minimumRating: 7, language: "ru" },
    { language: "ru" },
  );
  assert.equal(results[0]?.item.title, "Русский фильм");
  assert.equal(results[0]?.item.genres?.[0]?.name, "Военные");
  assert.match(paths[0]!, /\/ru-RU\/catalog\/movie\/tmdb.top\/genre=/u);
  assert.equal(paths.length, 1);
});

test("details reject conflicting IMDb identities", async () => {
  const provider = tmdbProvider({
    baseUrl: "https://addon.example",
    fetch: async () =>
      Response.json({
        meta: { id: "tmdb:42", imdb_id: "tt7654321", type: "movie", name: "Wrong film" },
      }),
  });
  assert.equal(
    await provider.getDetails?.({ ids: { imdb: "tt1234567" }, type: "movie" }, {}),
    null,
  );
});

test("untyped discovery keeps both movie and series candidates", async () => {
  const provider = tmdbProvider({
    baseUrl: "https://addon.example",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      const type = path.includes("/movie/") ? "movie" : "series";
      return Response.json({
        metas: [
          {
            id: type === "movie" ? "tmdb:1" : "tmdb:2",
            type,
            name: type === "movie" ? "Фильм" : "Сериал",
            genres: ["военный"],
          },
        ],
      });
    },
  });
  const results = await provider.search(
    { genre: "War", language: "ru", limit: 1 },
    { language: "ru" },
  );
  assert.deepEqual(
    results.map((entry) => entry.item.type),
    ["movie", "series"],
  );
});
