import assert from "node:assert/strict";
import { test } from "node:test";

import { aniListProvider } from "./index.js";

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

test("aniListProvider ignores non-anime queries and validates limits", async () => {
  const provider = aniListProvider({ fetch: async () => Response.json({ data: {} }) });
  assert.deepEqual(await provider.search({ title: "Interstellar", type: "movie" }, {}), []);
  assert.throws(() => aniListProvider({ searchLimit: 51 }), /between 1 and 50/);
});
