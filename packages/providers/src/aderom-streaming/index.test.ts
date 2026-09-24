import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderError } from "@media-engine/core";
import { aderomStreamingProvider } from "./index.js";

test("Aderom returns a verified generic iframe for a matching dubbed series", async () => {
  const urls: string[] = [];
  const provider = aderomStreamingProvider({
    apiBaseUrl: "https://api.test",
    embedBaseUrl: "https://embed.test",
    fetch: async (input) => {
      const url = input.toString();
      urls.push(url);
      return url.includes("/api/")
        ? Response.json({
            kinopoisk_id: 464963,
            title: "Игра престолов",
            category: "Зарубежные сериалы",
            year: 2011,
            translation: [{ id: 12, name: "Дубляж", seasons: { 1: [1] } }],
          })
        : new Response("<html>player</html>");
    },
  });

  const result = await provider.getAvailability(
    { type: "series", ids: { kinopoisk: "464963" } },
    {},
  );
  assert.deepEqual(urls, ["https://api.test/api/464963", "https://embed.test/tvb/464963"]);
  assert.equal(result?.options[0]?.player.kind, "embed");
  assert.equal(result?.options[0]?.access.url, "https://embed.test/tvb/464963");
  assert.equal(result?.item?.title, "Игра престолов");
  assert.equal(result?.item?.ids?.kinopoisk, "464963");
});

test("Aderom resolves a missing Kinopoisk ID from an exact IMDb identity", async () => {
  const urls: string[] = [];
  const provider = aderomStreamingProvider({
    apiBaseUrl: "https://api.test",
    embedBaseUrl: "https://embed.test",
    fetch: async (input) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("action=query"))
        return Response.json({ query: { search: [{ title: "Q23572" }] } });
      if (url.includes("action=wbgetclaims"))
        return Response.json({
          claims: { P2603: [{ mainsnak: { datavalue: { value: "464963" } } }] },
        });
      if (url === "https://api.test/api/464963")
        return Response.json({
          kinopoisk_id: 464963,
          title: "Игра престолов",
          category: "Зарубежные сериалы",
          translation: [{ name: "Дубляж" }],
        });
      return new Response("<html>player</html>");
    },
  });

  const result = await provider.getAvailability({ type: "series", ids: { imdb: "tt0944947" } }, {});
  const search = new URL(urls[0]!);
  const claims = new URL(urls[1]!);
  assert.equal(search.searchParams.get("srsearch"), "haswbstatement:P345=tt0944947");
  assert.equal(claims.searchParams.get("entity"), "Q23572");
  assert.equal(claims.searchParams.get("property"), "P2603");
  assert.deepEqual(urls.slice(2), ["https://api.test/api/464963", "https://embed.test/tvb/464963"]);
  assert.deepEqual(result?.item?.ids, { imdb: "tt0944947", kinopoisk: "464963" });
});

test("Aderom skips ambiguous IMDb to Kinopoisk mappings", async () => {
  let calls = 0;
  const provider = aderomStreamingProvider({
    fetch: async () => {
      calls += 1;
      return Response.json({ query: { search: [{ title: "Q23572" }, { title: "Q123456" }] } });
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "series", ids: { imdb: "tt0944947" } }, {}),
    null,
  );
  assert.equal(calls, 1);
});

test("Aderom skips unsupported and missing media and rejects mismatched identity", async () => {
  let calls = 0;
  const provider = aderomStreamingProvider({
    fetch: async () => {
      calls += 1;
      return Response.json({ error: "not found" });
    },
  });
  assert.equal(
    await provider.getAvailability({ type: "movie", ids: { kinopoisk: "258687" } }, {}),
    null,
  );
  assert.equal(
    await provider.getAvailability(
      { type: "anime", ids: { kinopoisk: "283290" }, absoluteEpisodeNumber: 1 },
      {},
    ),
    null,
  );
  assert.equal(
    await provider.getAvailability({ type: "series", ids: { kinopoisk: "464963" } }, {}),
    null,
  );
  assert.equal(calls, 1);

  const mismatch = aderomStreamingProvider({
    fetch: async () =>
      Response.json({ kinopoisk_id: 123, title: "Wrong", category: "Аниме", translation: [] }),
  });
  await assert.rejects(
    mismatch.getAvailability({ type: "anime", ids: { kinopoisk: "283290" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});
