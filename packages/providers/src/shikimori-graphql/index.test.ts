import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@media-engine/core";
import { shikimoriGraphqlProvider } from "./index.js";

const anime = {
  id: "1535",
  malId: "1535",
  name: "Death Note",
  russian: "Тетрадь смерти",
  english: "Death Note",
  japanese: "デスノート",
  synonyms: ["DN"],
  description: "История о [[Тетради смерти]] и [character=71]L[/character].",
  kind: "tv",
  episodes: 37,
  episodesAired: 0,
  score: 8.6,
  status: "released",
  airedOn: { date: "2006-10-04", year: 2006 },
  releasedOn: { date: "2007-06-27" },
  poster: { originalUrl: "https://shikimori.io/poster.jpg" },
  screenshots: [{ originalUrl: "https://shikimori.io/backdrop.jpg" }],
  genres: [{ id: "117", name: "Suspense", russian: "Триллер" }],
};

test("shikimoriGraphqlProvider maps Russian anime release metadata", async () => {
  let headers: Headers | undefined;
  const provider = shikimoriGraphqlProvider({
    userAgent: "yaneMedia/1.0",
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ data: { animes: [anime] } });
    },
  });
  const result = await provider.getDetails?.(
    { type: "anime", ids: { shikimori: "1535", myAnimeList: "1535" } },
    { language: "ru" },
  );

  assert.equal(result?.details.title, "Тетрадь смерти");
  assert.equal(result?.details.description, "История о Тетради смерти и L.");
  assert.equal(result?.details.type, "anime");
  assert.equal(result?.details.type === "anime" && result.details.animeKind, "tv");
  assert.equal(result?.details.type === "anime" && result.details.episodesCount, 37);
  assert.equal(result?.details.backdrop?.url, "https://shikimori.io/backdrop.jpg");
  assert.equal(headers?.get("user-agent"), "yaneMedia/1.0");
  assert.equal(provider.capabilities.metadataRoute, "primary");
});

test("shikimoriGraphqlProvider rejects conflicting MAL identity", async () => {
  const provider = shikimoriGraphqlProvider({
    userAgent: "yaneMedia/1.0",
    fetch: async () => Response.json({ data: { animes: [anime] } }),
  });
  assert.equal(
    await provider.getDetails?.(
      { type: "anime", ids: { shikimori: "1535", myAnimeList: "999" } },
      {},
    ),
    null,
  );
});

test("shikimoriGraphqlProvider fails closed on GraphQL errors and missing User-Agent", async () => {
  const malformed = shikimoriGraphqlProvider({
    userAgent: "yaneMedia/1.0",
    fetch: async () => Response.json({ errors: [{ message: "private upstream detail" }] }),
  });
  await assert.rejects(
    malformed.getDetails!({ type: "anime", ids: { shikimori: "1535" } }, {}),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "PROVIDER_INVALID_RESPONSE" &&
      !error.message.includes("private upstream detail"),
  );

  const unconfigured = shikimoriGraphqlProvider();
  await assert.rejects(
    unconfigured.getDetails!({ type: "anime", ids: { shikimori: "1535" } }, {}),
    (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_UNAUTHORIZED",
  );
});

test("shikimoriGraphqlProvider discovers filtered anime through official GraphQL filters", async () => {
  const requests: Array<{ query: string; variables: Record<string, string | number> }> = [];
  const provider = shikimoriGraphqlProvider({
    userAgent: "yaneMedia/1.0",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, string | number>;
      };
      requests.push(body);
      if (body.query.includes("genres(entryType: Anime)")) {
        return Response.json({
          data: { genres: [{ id: "117", name: "Suspense", russian: "Триллер" }] },
        });
      }
      return Response.json({
        data: { animes: [{ ...anime, airedOn: { date: "2024-01-10", year: 2024 } }] },
      });
    },
  });

  const results = await provider.search(
    { type: "anime", year: 2024, genre: "Thriller", minimumRating: 7.2, limit: 49 },
    { language: "ru" },
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.variables, {
    page: 1,
    limit: 49,
    season: "2024",
    genre: "117",
    score: 7,
  });
  assert.match(requests[1]?.query ?? "", /order: ranked/u);
  assert.ok(results[0]?.item.genres?.some((genre) => genre.name === "Thriller"));
  assert.deepEqual(provider.capabilities.search.filterDiscovery, [
    "year",
    "genre",
    "minimumRating",
  ]);
});

test("shikimoriGraphqlProvider does not mark title results with an unverified genre", async () => {
  const provider = shikimoriGraphqlProvider({
    userAgent: "yaneMedia/1.0",
    fetch: async () => Response.json({ data: { animes: [anime] } }),
  });

  const results = await provider.search(
    { type: "anime", title: "Death Note", genre: "Comedy" },
    {},
  );

  assert.equal(results.length, 1);
  assert.equal(
    results[0]?.item.genres?.some((genre) => genre.name === "Comedy"),
    false,
  );
});
