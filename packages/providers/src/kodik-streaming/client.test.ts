import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createKodikConfig } from "./config.js";
import { parseKodikResponse, searchKodik } from "./client.js";

test("searchKodik keeps the token in bounded upstream requests and falls back across exact IDs", async () => {
  const requests: URL[] = [];
  const config = createKodikConfig({
    apiKey: "owned-secret",
    baseUrl: "https://kodik.test",
    fetch: async (input) => {
      const url = new URL(input.toString());
      requests.push(url);
      return Response.json(
        url.searchParams.has("kinopoisk_id")
          ? { time: "1ms", total: 0, results: [] }
          : { time: "1ms", total: 1, results: [movieFixture()] },
      );
    },
  });

  const result = await searchKodik(
    config,
    { type: "movie", ids: { kinopoisk: "1043758", imdb: "tt6751668" } },
    {},
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.searchParams.get("token"), "owned-secret");
  assert.equal(requests[0]?.searchParams.get("kinopoisk_id"), "1043758");
  assert.equal(requests[1]?.searchParams.get("imdb_id"), "tt6751668");
  assert.equal(requests[1]?.searchParams.get("with_episodes"), "true");
  assert.equal(result?.sourceUrl, "https://kodik.test/search");
  assert.equal(JSON.stringify(result).includes("owned-secret"), false);
});

test("parseKodikResponse parses translations, restrictions, and bounded episode maps", () => {
  const [result] = parseKodikResponse(
    "kodik-streaming",
    {
      total: 1,
      results: [
        {
          id: "serial-1",
          type: "anime-serial",
          link: "//kodik.test/serial/1",
          title: "Тест",
          title_orig: "Test",
          year: 2024,
          kinopoisk_id: "10",
          imdb_id: "tt1234567",
          shikimori_id: "20",
          translation: { id: 609, title: "AniDUB", type: "voice" },
          quality: "WEB-DLRip 720p",
          blocked_countries: ["RU"],
          blocked_seasons: { "2": true, "3": false },
          seasons: {
            "1": { link: "//kodik.test/serial/1/1", episodes: { "1": "//kodik.test/1/1" } },
          },
        },
      ],
    },
    10,
  );

  assert.deepEqual(result?.translation, { id: "609", title: "AniDUB", type: "voice" });
  assert.deepEqual(result?.blockedCountries, ["RU"]);
  assert.deepEqual([...result!.blockedSeasons], [2]);
  assert.equal(result?.seasons[1]?.episodes[1], "//kodik.test/1/1");
});

test("parseKodikResponse rejects malformed non-empty payloads without exposing raw data", () => {
  assert.throws(
    () => parseKodikResponse("kodik-streaming", { results: [{ token: "never-report" }] }, 10),
    (error) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_INVALID_RESPONSE" &&
      !error.message.includes("never-report"),
  );
});

test("searchKodik redacts a token echoed by a failing transport", async () => {
  const config = createKodikConfig({
    apiKey: "owned-secret",
    fetch: async (input) => {
      throw new Error(`failed ${input.toString()}`);
    },
  });

  await assert.rejects(
    searchKodik(config, { type: "movie", ids: { kinopoisk: "1" } }, {}),
    (error) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      !error.message.includes("owned-secret") &&
      error.cause === undefined,
  );
});

function movieFixture() {
  return {
    id: "movie-39523",
    type: "foreign-movie",
    link: "//kodik.test/video/39523",
    title: "Паразиты",
    title_orig: "Gisaengchung",
    year: 2019,
    kinopoisk_id: "1043758",
    imdb_id: "tt6751668",
    translation: { id: 704, title: "Дублированный", type: "voice" },
    quality: "BDRip 720p",
    blocked_countries: [],
    blocked_seasons: {},
  };
}
