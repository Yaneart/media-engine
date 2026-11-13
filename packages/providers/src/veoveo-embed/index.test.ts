import assert from "node:assert/strict";
import { test } from "node:test";
import { veoVeoEmbedProvider } from "./index.js";

const query = { type: "movie" as const, ids: { kinopoisk: "409424", imdb: "tt1160419" } };
const details = {
  id: 988,
  kinopoiskId: 409424,
  imdbId: "tt1160419",
  title: "Dune",
  contentType: { name: "Фильмы" },
};

test("VeoVeo embed verifies identity and returns one public player without loading HLS", async () => {
  const urls: URL[] = [];
  const provider = veoVeoEmbedProvider({
    apiKey: "public-fixture",
    allowApiKeyInEmbedUrl: true,
    fetch: async (input) => {
      const url = new URL(input);
      urls.push(url);
      return url.pathname.endsWith("/iframe")
        ? new Response("window.MOVIE_ID=988;")
        : Response.json(details);
    },
  });
  const result = await provider.getAvailability(query, {});
  assert.equal(result?.options.length, 1);
  assert.equal(result?.options[0]?.player.kind, "embed");
  assert.equal(result?.options[0]?.provider, "veoveo-embed");
  assert.equal(new URL(result!.options[0]!.access.url).searchParams.get("token"), "public-fixture");
  assert.equal(urls.length, 2);
  assert.equal(urls[1]?.searchParams.has("token"), false);
  assert.equal(provider.capabilities.lookup.byEpisode, false);
});

test("VeoVeo embed requires public-token consent and never invents exact episode links", async () => {
  const provider = veoVeoEmbedProvider({
    apiKey: "private-fixture",
    fetch: async () => {
      throw new Error("unexpected request");
    },
  });
  await assert.rejects(provider.getAvailability(query, {}), { code: "PROVIDER_UNAUTHORIZED" });
  assert.equal(
    await provider.getAvailability(
      { ...query, type: "series", seasonNumber: 1, episodeNumber: 1 },
      {},
    ),
    null,
  );
  assert.equal(
    await provider.getAvailability({ ...query, providers: ["veoveo-streaming"] }, {}),
    null,
  );
  assert.equal(await provider.getAvailability({ type: "movie", ids: { tmdb: "1" } }, {}), null);
});

test("VeoVeo embed rejects conflicting IDs, mismatched types, and unknown catalog kinds", async () => {
  for (const change of [
    { kinopoiskId: 123 },
    { imdbId: "tt0000001" },
    { contentType: { name: "Сериалы" } },
    { contentType: { name: "unknown" } },
  ]) {
    const provider = veoVeoEmbedProvider({
      apiKey: "public-fixture",
      allowApiKeyInEmbedUrl: true,
      fetch: async (input) =>
        new URL(input).pathname.endsWith("/iframe")
          ? new Response("window.MOVIE_ID=988;")
          : Response.json({ ...details, ...change }),
    });
    assert.equal(await provider.getAvailability(query, {}), null);
  }
});

test("VeoVeo generic series keeps episode and translation selection inside the player", async () => {
  const provider = veoVeoEmbedProvider({
    apiKey: "public-fixture",
    allowApiKeyInEmbedUrl: true,
    fetch: async (input) =>
      new URL(input).pathname.endsWith("/iframe")
        ? new Response("window.MOVIE_ID=988;")
        : Response.json({ ...details, contentType: { name: "Сериалы" } }),
  });
  const result = await provider.getAvailability({ ...query, type: "series" }, {});
  assert.equal(result?.options.length, 1);
  assert.equal(result?.options[0]?.episode, undefined);
});
