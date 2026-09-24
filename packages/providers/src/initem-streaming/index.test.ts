import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderError } from "@media-engine/core";
import { initemStreamingProvider } from "./index.js";

const playerHtml =
  '<title>Sample</title><script>makePlayer({ source: { hls: "https://cdn.test/master.m3u8", audio: {"names":["Рус. Дублированный"]} } });</script>';

test("Initem returns an embed for each supported media type by Kinopoisk ID", async () => {
  const urls: string[] = [];
  const provider = initemStreamingProvider({
    fetch: async (input) => {
      urls.push(input.toString());
      return new Response(playerHtml, { headers: { "content-type": "text/html" } });
    },
  });
  for (const [type, id] of [
    ["movie", "258687"],
    ["series", "464963"],
    ["anime", "5401195"],
  ] as const) {
    const result = await provider.getAvailability({ type, ids: { kinopoisk: id } }, {});
    assert.equal(result?.options[0]?.player.kind, "embed");
    assert.equal(result?.options[0]?.access.url, `https://api.initem.ws/embed/kp/${id}`);
  }
  assert.equal(urls.length, 3);
});

test("Initem uses IMDb when the selected card has no Kinopoisk ID", async () => {
  const provider = initemStreamingProvider({ fetch: async () => new Response(playerHtml) });
  const result = await provider.getAvailability(
    { type: "movie", ids: { imdb: "tt0816692", tmdb: "157336" } },
    {},
  );
  assert.equal(result?.options[0]?.access.url, "https://api.initem.ws/embed/imdb/tt0816692");
  assert.equal(result?.item?.ids?.imdb, "tt0816692");
});

test("Initem rejects absent and non-player responses", async () => {
  const missing = initemStreamingProvider({
    fetch: async () => new Response("missing", { status: 404 }),
  });
  assert.equal(
    await missing.getAvailability({ type: "movie", ids: { kinopoisk: "258687" } }, {}),
    null,
  );
  const invalid = initemStreamingProvider({ fetch: async () => new Response("<title>Ad</title>") });
  await assert.rejects(
    invalid.getAvailability({ type: "anime", ids: { kinopoisk: "5401195" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
  assert.equal(
    await invalid.getAvailability(
      { type: "series", ids: { kinopoisk: "464963" }, seasonNumber: 1, episodeNumber: 1 },
      {},
    ),
    null,
  );
});
