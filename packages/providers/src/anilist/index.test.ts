import assert from "node:assert/strict";
import { test } from "node:test";

import { aniListProvider } from "./index.js";

test("aniListProvider guarantees stable search and details posters", () => {
  const provider = aniListProvider();
  assert.equal(provider.searchPosterMatchesDetails, true);
  assert.deepEqual(provider.capabilities.relatedMedia?.byExternalIds, ["aniList", "myAnimeList"]);
  assert.equal(provider.capabilities.features?.includes("relations"), true);
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
                bannerImage: "https://images.example/attack-on-titan-banner.jpg",
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
  assert.equal(results[0]?.item.backdrop?.url, "https://images.example/attack-on-titan-banner.jpg");
  assert.equal(body.variables?.search, "Attack on Titan");
  assert.match(body.query ?? "", /POPULARITY_DESC/);
  assert.match(body.query ?? "", /bannerImage/);
});

test("aniListProvider discovers anime by year, genre, and minimum rating", async () => {
  let body: { query?: string; variables?: Record<string, unknown> } = {};
  const provider = aniListProvider({
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          Page: {
            media: [
              {
                id: 21,
                title: { english: "One Piece" },
                startDate: { year: 1999 },
                averageScore: 89,
                genres: ["Action", "Adventure"],
              },
            ],
          },
        },
      });
    },
  });

  const results = await provider.search(
    { type: "anime", year: 1999, genre: "Action", minimumRating: 8 },
    {},
  );

  assert.equal(results[0]?.item.title, "One Piece");
  assert.equal(body.variables?.search, undefined);
  assert.equal(body.variables?.year, 1999);
  assert.equal(body.variables?.genre, "Action");
  assert.equal(body.variables?.minimumScore, 79);
  assert.match(body.query ?? "", /POPULARITY_DESC, SCORE_DESC/);
  assert.deepEqual(provider.capabilities.search.filterDiscovery, [
    "year",
    "genre",
    "minimumRating",
  ]);
});

test("aniListProvider loads enough pages for a bounded search window", async () => {
  const requestedPages: number[] = [];
  const provider = aniListProvider({
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        variables?: { page?: number; perPage?: number };
      };
      const page = body.variables?.page ?? 1;
      const pageSize = body.variables?.perPage ?? 50;
      requestedPages.push(page);
      const count = page === 1 ? pageSize : 3;
      const start = (page - 1) * pageSize;

      return Response.json({
        data: {
          Page: {
            pageInfo: { hasNextPage: page === 1 },
            media: Array.from({ length: count }, (_, index) => ({
              id: start + index + 1,
              title: { english: `Anime ${start + index + 1}` },
              genres: ["Action"],
            })),
          },
        },
      });
    },
  });

  const results = await provider.search({ type: "anime", genre: "Action", limit: 52 }, {});

  assert.equal(results.length, 52);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(results.at(-1)?.item.title, "Anime 52");
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
            coverImage: { extraLarge: "https://images.example/death-note-cover.jpg" },
            bannerImage: "https://images.example/death-note-banner.jpg",
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
  assert.equal(result?.details.backdrop?.type, "backdrop");
  assert.equal(result?.details.backdrop?.url, "https://images.example/death-note-banner.jpg");
  assert.deepEqual(
    result?.details.images?.map((image) => image.type),
    ["poster", "backdrop"],
  );
});

test("aniListProvider omits missing banner artwork", async () => {
  const provider = aniListProvider({
    fetch: async () =>
      Response.json({
        data: {
          Media: {
            id: 52991,
            title: { english: "Frieren: Beyond Journey's End" },
            coverImage: { large: "https://images.example/frieren-cover.jpg" },
            bannerImage: null,
          },
        },
      }),
  });

  const result = await provider.getDetails?.({ type: "anime", ids: { aniList: "52991" } }, {});

  assert.equal(result?.details.backdrop, undefined);
  assert.deepEqual(
    result?.details.images?.map((image) => image.type),
    ["poster"],
  );
});

test("aniListProvider maps bounded anime relationships and preserves relation kinds", async () => {
  let body: { query?: string; variables?: Record<string, unknown> } = {};
  const relationTypes = [
    "ADAPTATION",
    "ALTERNATIVE",
    "CHARACTER",
    "COMPILATION",
    "CONTAINS",
    "OTHER",
    "PARENT",
    "PREQUEL",
    "SEQUEL",
    "SIDE_STORY",
    "SOURCE",
    "SPIN_OFF",
    "SUMMARY",
    "FUTURE_VALUE",
  ];
  const provider = aniListProvider({
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          Media: {
            relations: {
              edges: [
                ...relationTypes.map((relationType, index) => ({
                  relationType,
                  node: {
                    id: 170_000 + index,
                    idMal: 60_000 + index,
                    type: "ANIME",
                    title: { english: `Related ${index}`, romaji: `Relation ${index}` },
                    format: index === 8 ? "TV" : "SPECIAL",
                    status: index === 8 ? "RELEASING" : "FINISHED",
                    episodes: index === 8 ? 10 : 1,
                    startDate: { year: 2026, month: 1, day: 1 },
                  },
                })),
                {
                  relationType: "ADAPTATION",
                  node: { id: 1, type: "MANGA", title: { english: "Manga" } },
                },
              ],
            },
          },
        },
      });
    },
  });

  const result = await provider.getRelatedMedia?.(
    { ids: { aniList: "154587" }, type: "anime" },
    { debug: true },
  );

  assert.equal(body.variables?.id, 154587);
  assert.match(body.query ?? "", /relations/);
  assert.deepEqual(
    result?.relations.map((relation) => relation.kind),
    [
      "adaptation",
      "alternative",
      "character",
      "compilation",
      "contains",
      "other",
      "parent_story",
      "prequel",
      "sequel",
      "side_story",
      "source",
      "spin_off",
      "summary",
      "other",
    ],
  );
  const sequel = result?.relations[8];
  assert.equal(sequel?.item.ids?.aniList, "170008");
  assert.equal(sequel?.item.ids?.myAnimeList, "60008");
  assert.equal(sequel?.item.animeKind, "tv");
  assert.equal(sequel?.item.status, "ongoing");
  assert.equal(sequel?.item.episodesCount, 10);
  assert.equal(sequel?.source?.url, "https://anilist.co/anime/170008");
  assert.equal(Array.isArray(result?.raw), true);
});

test("aniListProvider supports MyAnimeList relation lookup and ignores unsupported queries", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = aniListProvider({
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { variables: Record<string, unknown> };
      requests.push(body.variables);
      return Response.json({
        data: {
          Media: {
            relations: {
              edges: [
                {
                  relationType: "SEQUEL",
                  node: { id: 2, type: "ANIME", title: { english: "Two" } },
                },
                {
                  relationType: "SEQUEL",
                  node: { id: 3, type: "ANIME", title: { english: "Three" } },
                },
              ],
            },
          },
        },
      });
    },
  });

  const limited = await provider.getRelatedMedia?.({ ids: { myAnimeList: "52991" }, limit: 1 }, {});
  assert.equal(limited?.relations.length, 1);
  assert.deepEqual(requests[0], { idMal: 52991 });
  assert.equal(limited?.raw, undefined);
  assert.equal(
    await provider.getRelatedMedia?.({ ids: { aniList: "1" }, type: "movie" }, {}),
    null,
  );
  assert.equal(await provider.getRelatedMedia?.({ ids: { shikimori: "1" } }, {}), null);
  assert.equal(requests.length, 1);
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
