import assert from "node:assert/strict";
import { test } from "node:test";

import { aniListProvider } from "./index.js";

test("aniListProvider guarantees stable search and details posters", () => {
  assert.equal(aniListProvider().searchPosterMatchesDetails, true);
});

test("aniListProvider searches English anime titles with popularity", async () => {
  let body: { query?: string; variables?: Record<string, unknown> } = {};
  const provider = aniListProvider({
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          Page: {
            media: [
              {
                id: 16498,
                idMal: 16498,
                title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan" },
                format: "TV",
                startDate: { year: 2013, month: 4, day: 7 },
                averageScore: 84,
                popularity: 4_000_000,
                description: "First line.<br><br><b>Second line.</b>",
              },
            ],
          },
        },
      });
    },
  });

  const results = await provider.search({ title: "Attack on Titan" }, {});

  assert.equal(results[0]?.item.title, "Attack on Titan");
  assert.equal(results[0]?.item.originalTitle, "Shingeki no Kyojin");
  assert.equal(results[0]?.item.ids?.aniList, "16498");
  assert.equal(results[0]?.item.ratings?.[0]?.votes, 4_000_000);
  assert.equal(results[0]?.item.description, "First line.\n\nSecond line.");
  assert.equal(body.variables?.search, "Attack on Titan");
  assert.match(body.query ?? "", /POPULARITY_DESC/);
});

test("aniListProvider loads details by AniList ID", async () => {
  const provider = aniListProvider({
    fetch: async () =>
      Response.json({
        data: {
          Media: {
            id: 1535,
            idMal: 1535,
            title: { romaji: "Death Note", english: "Death Note" },
            format: "TV",
            status: "FINISHED",
            episodes: 37,
            duration: 23,
            countryOfOrigin: "JP",
            startDate: { year: 2006, month: 10, day: 4 },
            endDate: { year: 2007, month: 6, day: 27 },
          },
        },
      }),
  });

  const result = await provider.getDetails?.({ type: "anime", ids: { aniList: "1535" } }, {});

  assert.equal(result?.details.type, "anime");
  assert.equal(result?.details.status, "ended");
  assert.equal(result?.details.episodesCount, 37);
  assert.equal(result?.details.runtimeMinutes, 23);
});

test("aniListProvider repairs mojibake in titles, aliases, and descriptions", async () => {
  const provider = aniListProvider({
    fetch: async () =>
      Response.json({
        data: {
          Page: {
            media: [
              {
                id: 1,
                title: { english: "POKÃ‰TOON", romaji: "PokÃ©toon" },
                synonyms: ["PokÃ©mon Cartoon"],
                description: "A PokÃ©mon short &amp; story.",
              },
            ],
          },
        },
      }),
  });

  const [result] = await provider.search({ title: "Poketoon" }, {});

  assert.equal(result?.item.title, "POKÉTOON");
  assert.equal(result?.item.originalTitle, "Pokétoon");
  assert.deepEqual(result?.item.alternativeTitles, ["Pokétoon", "Pokémon Cartoon"]);
  assert.equal(result?.item.description, "A Pokémon short & story.");
});

test("aniListProvider ignores non-anime queries and validates limits", async () => {
  const provider = aniListProvider({ fetch: async () => Response.json({ data: {} }) });
  assert.deepEqual(await provider.search({ title: "Interstellar", type: "movie" }, {}), []);
  assert.throws(() => aniListProvider({ searchLimit: 51 }), /between 1 and 50/);
});
