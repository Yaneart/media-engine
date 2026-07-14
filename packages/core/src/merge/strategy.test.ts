import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaDetails, MediaItem } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning } from "../response/index.js";
import { DefaultMergeStrategy } from "./strategy.js";

const strategy = new DefaultMergeStrategy();

test("merges exact external ID matches into one search result", () => {
  const warnings: EngineWarning[] = [];
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "Interstellar",
        year: 2014,
        ids: { tmdb: "157336", imdb: "tt0816692" },
        genres: [{ name: "Science Fiction" }],
        ratings: [{ source: "tmdb", value: 8.4, max: 10 }],
      }),
      providerResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "Interstellar",
        originalTitle: "Interstellar",
        alternativeTitles: ["Interstellar 2014"],
        year: 2014,
        ids: { imdb: "tt0816692" },
        genres: [{ name: "Sci-Fi" }],
        ratings: [{ source: "imdb", value: 8.7, max: 10 }],
      }),
    ],
    { warnings },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 1);
  assert.deepEqual(results[0]?.item.ids, { tmdb: "157336", imdb: "tt0816692" });
  assert.deepEqual(
    results[0]?.item.ratings?.map((rating) => rating.source),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(
    results[0]?.sources.map((source) => source.provider),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(warnings, []);
});

test("selects localized titles and descriptions when language is explicit", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "one-piece-en",
        type: "anime",
        title: "One Piece",
        year: 1999,
        description: "A much longer English description about pirates and adventure.",
        ids: { imdb: "tt0388629" },
      }),
      providerResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        year: 1999,
        description: "Русское описание приключений пиратов.",
        ids: { imdb: "tt0388629", shikimori: "21" },
      }),
    ],
    { query: { title: "one piece", language: "ru" }, language: "ru" },
  );

  assert.equal(search[0]?.item.title, "Ван-Пис");
  assert.equal(search[0]?.item.description, "Русское описание приключений пиратов.");

  const details = strategy.mergeDetails(
    [
      providerDetailsResult("cinemeta", {
        id: "one-piece-en",
        type: "anime",
        title: "One Piece",
        description: "A much longer English description about pirates and adventure.",
      }),
      providerDetailsResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        description: "Русское описание приключений пиратов.",
      }),
    ],
    { query: { type: "anime", language: "ru" }, language: "ru" },
  );

  assert.equal(details?.title, "Ван-Пис");
  assert.equal(details?.description, "Русское описание приключений пиратов.");
});

test("selects an English original title for an English query", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("shikimori", {
        id: "one-piece-ru",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        year: 1999,
        ids: { shikimori: "21" },
      }),
    ],
    { query: { title: "one piece" }, language: "en" },
  );

  assert.equal(search[0]?.item.title, "One Piece");
  assert.deepEqual(search[0]?.item.alternativeTitles, ["Ван-Пис"]);
});

test("selects an exact English alias before a generic Latin-script title", () => {
  const search = strategy.mergeSearchResults(
    [
      providerResult("anilist", {
        id: "spirited-away",
        type: "anime",
        title: "Sen to Chihiro no Kamikakushi",
        alternativeTitles: ["Spirited Away"],
        year: 2001,
        ids: { aniList: "199" },
      }),
    ],
    { query: { title: "spirited away" }, language: "en" },
  );

  assert.equal(search[0]?.item.title, "Spirited Away");
});

test("warns on conflicting strong IDs without overwriting provider priority value", () => {
  const warnings: EngineWarning[] = [];
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Shared Movie",
        year: 2020,
        ids: { tmdb: "1", imdb: "tt-good" },
      }),
      providerResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Shared Movie",
        year: 2020,
        ids: { tmdb: "1", imdb: "tt-conflict" },
      }),
    ],
    { warnings },
  );

  assert.equal(results.length, 1);
  assert.deepEqual(results[0]?.item.ids, { tmdb: "1", imdb: "tt-good" });
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging search results; kept tt-good.",
      provider: "imdb",
    },
  ]);
});

test("does not auto-merge weak title matches", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-fma",
        type: "anime",
        title: "Fullmetal Alchemist",
        year: 2003,
      }),
      providerResult("shikimori", {
        id: "shikimori-fma-brotherhood",
        type: "anime",
        title: "Fullmetal Alchemist: Brotherhood",
        year: 2009,
      }),
    ],
    {},
  );

  assert.equal(results.length, 2);
});

test("merges normalized title year type matches without fuzzy matching", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Spider-Man",
        year: 2002,
      }),
      providerResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Spider Man",
        year: 2002,
      }),
    ],
    {},
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 0.8);
});

test("keeps deterministic output order for equal scores", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("custom", {
        id: "b",
        type: "movie",
        title: "Beta",
        confidence: undefined,
      }),
      providerResult("custom", {
        id: "a",
        type: "movie",
        title: "Alpha",
        confidence: undefined,
      }),
    ],
    {},
  );

  assert.deepEqual(
    results.map((result) => result.item.title),
    ["Alpha", "Beta"],
  );
});

test("uses provider priority before title when equal scores come from different providers", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("shikimori", {
        id: "shikimori-game",
        type: "anime",
        title: "Anime Game",
        confidence: 1,
      }),
      providerResult("kinobd", {
        id: "kinobd-game",
        type: "movie",
        title: "Game Movie",
        confidence: 1,
      }),
    ],
    {},
  );

  assert.deepEqual(
    results.map((result) => result.sources[0]?.provider),
    ["kinobd", "shikimori"],
  );
});

test("ranks popular relevant series first for broad any-title search", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("kinobd", {
        id: "kinobd-game-of-thrones",
        type: "series",
        title: "Игра престолов",
        originalTitle: "Game of Thrones",
        year: 2011,
        ids: { imdb: "tt0944947", kinopoisk: "464963" },
        ratings: [
          { source: "kinopoisk", value: 9, max: 10, votes: 1000000 },
          { source: "imdb", value: 9.2, max: 10, votes: 2400000 },
        ],
        confidence: 0.97,
      }),
      providerResult("cinemeta", {
        id: "cinemeta-series-tt0944947",
        type: "series",
        title: "Game of Thrones",
        year: 2011,
        ids: { imdb: "tt0944947" },
        ratings: [{ source: "imdb", value: 9.2, max: 10, votes: 2400000 }],
        confidence: 0.95,
      }),
      providerResult("kinobd", {
        id: "kinobd-game-of-death",
        type: "movie",
        title: "Game of Death",
        year: 1978,
        ids: { imdb: "tt0077594", kinopoisk: "24795" },
        ratings: [{ source: "imdb", value: 5.9, max: 10, votes: 40000 }],
        confidence: 0.9,
      }),
      providerResult("shikimori", {
        id: "shikimori-game",
        type: "anime",
        title: "No Game No Life",
        year: 2014,
        ids: { shikimori: "19815" },
        ratings: [{ source: "shikimori", value: 8.1, max: 10, votes: 500000 }],
        confidence: 1,
      }),
    ],
    { query: { title: "game of" } },
  );

  assert.equal(results[0]?.item.title, "Игра престолов");
  assert.equal(results[0]?.item.type, "series");
  assert.deepEqual(
    results[0]?.sources.map((source) => source.provider),
    ["kinobd", "cinemeta"],
  );
});

test("ranks a popular exact anime above less popular live-action adaptations", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("wikidata", {
        id: "death-note-movie",
        type: "movie",
        title: "Death Note",
        year: 2017,
        ratings: [{ source: "imdb", value: 4.5, max: 10, votes: 96_000 }],
        ids: { imdb: "tt1241317" },
      }),
      providerResult("anilist", {
        id: "death-note-anime",
        type: "anime",
        title: "Death Note",
        year: 2006,
        ratings: [{ source: "myAnimeList", value: 8.62, max: 10, votes: 2_900_000 }],
        ids: { myAnimeList: "1535" },
      }),
    ],
    { query: { title: "death note" } },
  );

  assert.equal(results[0]?.item.type, "anime");
  assert.equal(results[0]?.item.year, 2006);
});

test("ranks exact canonical titles above popular prefixed and incidental alias noise", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "dark-series",
        type: "series",
        title: "Dark",
        year: 2017,
        ratings: [{ source: "imdb", value: 8.7, max: 10, votes: 730_000 }],
        ids: { imdb: "tt5753856" },
      }),
      providerResult("wikidata", {
        id: "dark-series-wikidata",
        type: "series",
        title: "Dark",
        year: 2017,
        ids: { imdb: "tt5753856" },
      }),
      providerResult("shikimori", {
        id: "dark-gathering",
        type: "anime",
        title: "Dark Gathering",
        year: 2023,
        ratings: [{ source: "shikimori", value: 7.85, max: 10, votes: 66_000 }],
        ids: { shikimori: "52505" },
      }),
      providerResult("anilist", {
        id: "dark-god",
        type: "anime",
        title: "Kurokami The Animation",
        alternativeTitles: ["Dark God"],
        year: 2009,
        ratings: [{ source: "myAnimeList", value: 7.1, max: 10, votes: 23_000 }],
        ids: { myAnimeList: "5079" },
      }),
    ],
    { query: { title: "dark" } },
  );

  assert.equal(results[0]?.item.title, "Dark");
  assert.equal(results[0]?.item.type, "series");
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test("keeps sparse exact titles inside the preliminary enrichment window", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "dark-series",
        type: "series",
        title: "Dark",
        year: 2017,
        ids: { imdb: "tt5753856" },
      }),
      providerResult("shikimori", {
        id: "dark-gathering",
        type: "anime",
        title: "Dark Gathering",
        year: 2023,
        ratings: [{ source: "shikimori", value: 7.85, max: 10, votes: 66_000 }],
        ids: { shikimori: "52505" },
      }),
      providerResult("anilist", {
        id: "dark-gathering-anilist",
        type: "anime",
        title: "Dark Gathering",
        year: 2023,
        ratings: [{ source: "aniList", value: 75, max: 100, votes: 67_000 }],
        ids: { myAnimeList: "52505" },
      }),
    ],
    { query: { title: "dark" }, includeIrrelevantSearchResults: true },
  );

  assert.equal(results[0]?.item.title, "Dark");
  assert.equal(results[0]?.item.year, 2017);
});

test("keeps an exact title above popular prefixed franchise results when metadata is sparse", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "avatar-2009",
        type: "movie",
        title: "Avatar",
        year: 2009,
        ids: { imdb: "tt0499549" },
      }),
      providerResult("wikidata", {
        id: "avatar-2009-wikidata",
        type: "movie",
        title: "Avatar",
        year: 2009,
        ids: { imdb: "tt0499549" },
      }),
      providerResult("kinobd", {
        id: "avatar-series-2024",
        type: "series",
        title: "Аватар: Легенда об Аанге",
        originalTitle: "Avatar: The Last Airbender",
        year: 2024,
        ratings: [{ source: "imdb", value: 7.2, max: 10, votes: 85_000 }],
        ids: { imdb: "tt9018736" },
      }),
      providerResult("cinemeta", {
        id: "avatar-series-2024-cinemeta",
        type: "series",
        title: "Avatar: The Last Airbender",
        year: 2024,
        ids: { imdb: "tt9018736" },
      }),
    ],
    { query: { title: "avatar" } },
  );

  assert.equal(results[0]?.item.title, "Avatar");
  assert.equal(results[0]?.item.year, 2009);
});

test("filters unrelated provider noise from title searches", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "game-of-thrones",
        type: "series",
        title: "Game of Thrones",
        year: 2011,
      }),
      providerResult("shikimori", {
        id: "nausicaa",
        type: "anime",
        title: "Kaze no Tani no Nausicaa",
        year: 1984,
        ratings: [{ source: "shikimori", value: 8.36, max: 10 }],
      }),
    ],
    { query: { title: "game of" } },
  );

  assert.deepEqual(
    results.map((result) => result.item.title),
    ["Game of Thrones"],
  );
});

test("keeps a canonical result for a one-character title typo", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "game-of-thrones",
        type: "series",
        title: "Game of Thrones",
        year: 2011,
      }),
      providerResult("shikimori", {
        id: "unrelated",
        type: "anime",
        title: "Kara no Kyoukai",
        year: 2007,
      }),
    ],
    { query: { title: "game of trone" } },
  );

  assert.deepEqual(
    results.map((result) => result.item.title),
    ["Game of Thrones"],
  );
});

test("matches joined and punctuated title variants", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("shikimori", {
        id: "one-piece",
        type: "anime",
        title: "Ван-Пис",
        year: 1999,
      }),
    ],
    { query: { title: "ванпис" } },
  );

  assert.equal(results[0]?.item.title, "Ван-Пис");
});

test("merges anime and series title variants while preserving anime semantics", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("cinemeta", {
        id: "cinemeta-one-outs",
        type: "series",
        title: "One Outs",
        year: 2008,
        ids: { imdb: "tt1411815" },
        ratings: [{ source: "imdb", value: 8.2, max: 10 }],
        confidence: 0.95,
      }),
      providerResult("cinemeta", {
        id: "cinemeta-one-piece",
        type: "series",
        title: "One Piece",
        year: 1999,
        ids: { imdb: "tt0388629" },
        description: "A complete international synopsis.",
        poster: { url: "https://images.example/one-piece-modern.jpg", type: "poster" },
        confidence: 0.95,
      }),
      providerResult("shikimori", {
        id: "shikimori-one-piece",
        type: "anime",
        title: "Ван-Пис",
        originalTitle: "One Piece",
        year: 1999,
        ids: { shikimori: "21" },
        ratings: [{ source: "shikimori", value: 8.73, max: 10, votes: 700_000 }],
        confidence: 1,
      }),
      providerResult("anilist", {
        id: "anilist-one-piece",
        type: "anime",
        title: "One Piece",
        year: 1999,
        ids: { myAnimeList: "21", aniList: "21" },
        ratings: [{ source: "aniList", value: 87, max: 100, votes: 728_000 }],
        confidence: 1,
      }),
      providerResult("shikimori", {
        id: "shikimori-one",
        type: "anime",
        title: "One",
        year: 2020,
        ids: { shikimori: "56042" },
        ratings: [{ source: "shikimori", value: 5.8, max: 10 }],
        confidence: 1,
      }),
    ],
    { query: { title: "one" } },
  );

  assert.equal(results[0]?.item.title, "One Piece");
  assert.equal(results[0]?.item.type, "anime");
  assert.equal(results[0]?.item.description, "A complete international synopsis.");
  assert.equal(results[0]?.item.poster?.url, "https://images.example/one-piece-modern.jpg");
  assert.deepEqual(results[0]?.item.ids, {
    imdb: "tt0388629",
    shikimori: "21",
    myAnimeList: "21",
    aniList: "21",
  });
  assert.deepEqual(
    results[0]?.item.ratings?.map((rating) => rating.source),
    ["shikimori", "aniList"],
  );
  assert.deepEqual(
    results[0]?.sources.map((source) => source.provider),
    ["cinemeta", "shikimori", "anilist"],
  );
});

test("does not merge normalized title matches when strong IDs conflict", () => {
  const results = strategy.mergeSearchResults(
    [
      providerResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Duplicate Title",
        year: 2021,
        ids: { imdb: "tt-one" },
      }),
      providerResult("imdb", {
        id: "imdb-2",
        type: "movie",
        title: "Duplicate Title",
        year: 2021,
        ids: { imdb: "tt-two" },
      }),
    ],
    {},
  );

  assert.equal(results.length, 2);
});

test("returns null when there are no details results", () => {
  assert.equal(strategy.mergeDetails([], {}), null);
});

test("selects details primary result by provider priority", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "IMDb Interstellar",
        ids: { imdb: "tt0816692" },
      }),
      providerDetailsResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "TMDB Interstellar",
        ids: { tmdb: "157336" },
      }),
    ],
    {},
  );

  assert.equal(details?.id, "tmdb-157336");
  assert.equal(details?.title, "TMDB Interstellar");
  assert.deepEqual(details?.ids, { tmdb: "157336", imdb: "tt0816692" });
});

test("merges details ids ratings genres images and source providers", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-157336",
        type: "movie",
        title: "Interstellar",
        ids: { tmdb: "157336" },
        ratings: [{ source: "tmdb", value: 8.4, max: 10 }],
        genres: [{ name: "Science Fiction" }],
        poster: { url: "https://img.example/poster-small.jpg", type: "poster", width: 300 },
        images: [{ url: "https://img.example/tmdb-backdrop.jpg", type: "backdrop" }],
      }),
      providerDetailsResult("imdb", {
        id: "imdb-tt0816692",
        type: "movie",
        title: "Interstellar",
        ids: { imdb: "tt0816692" },
        ratings: [{ source: "imdb", value: 8.7, max: 10 }],
        genres: [{ name: "Drama" }],
        poster: { url: "https://img.example/poster-large.jpg", type: "poster", width: 900 },
        images: [{ url: "https://img.example/imdb-logo.jpg", type: "logo" }],
      }),
    ],
    {},
  );

  assert.deepEqual(details?.ids, { tmdb: "157336", imdb: "tt0816692" });
  assert.deepEqual(
    details?.ratings?.map((rating) => rating.source),
    ["tmdb", "imdb"],
  );
  assert.deepEqual(
    details?.genres?.map((genre) => genre.name),
    ["Science Fiction", "Drama"],
  );
  assert.equal(details?.poster?.url, "https://img.example/poster-large.jpg");
  assert.deepEqual(
    details?.images?.map((image) => image.url),
    [
      "https://img.example/poster-small.jpg",
      "https://img.example/tmdb-backdrop.jpg",
      "https://img.example/poster-large.jpg",
      "https://img.example/imdb-logo.jpg",
    ],
  );
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["tmdb", "imdb"],
  );
});

test("keeps details persons seasons and episodes from primary provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-series",
        type: "series",
        title: "Primary Series",
        persons: [
          {
            person: { name: "Primary Actor" },
            roles: ["actor"],
          },
        ],
        seasons: [{ number: 1, title: "Primary Season" }],
      }),
      providerDetailsResult("imdb", {
        id: "imdb-series",
        type: "series",
        title: "Secondary Series",
        persons: [
          {
            person: { name: "Secondary Actor" },
            roles: ["actor"],
          },
        ],
        seasons: [{ number: 1, title: "Secondary Season" }],
      }),
    ],
    {},
  );

  assert.equal(details?.type, "series");

  if (details === null || details.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(details.persons?.[0]?.person.name, "Primary Actor");
  assert.equal(details.seasons?.[0]?.title, "Primary Season");
});

test("fills series status and counters from secondary details provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("kinobd", {
        id: "kinobd-got",
        type: "series",
        title: "Игра престолов",
        ids: { kinopoisk: "464963", imdb: "tt0944947" },
      }),
      providerDetailsResult("cinemeta", {
        id: "cinemeta-got",
        type: "series",
        title: "Game of Thrones",
        ids: { imdb: "tt0944947", tmdb: "1399" },
        status: "ended",
        episodesCount: 73,
        seasonsCount: 8,
      }),
    ],
    {},
  );

  assert.equal(details?.type, "series");

  if (!details || details.type !== "series") {
    assert.fail("Expected series details.");
  }

  assert.equal(details.status, "ended");
  assert.equal(details.episodesCount, 73);
  assert.equal(details.seasonsCount, 8);
});

test("skips unknown details status when another provider has a meaningful status", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("primary", {
        id: "primary-got",
        type: "series",
        title: "Game of Thrones",
        status: "unknown",
        ids: { imdb: "tt0944947" },
      }),
      providerDetailsResult("secondary", {
        id: "secondary-got",
        type: "series",
        title: "Game of Thrones",
        status: "ended",
        ids: { imdb: "tt0944947" },
      }),
    ],
    {},
  );

  assert.equal(details?.status, "ended");
});

test("keeps anime episodes from primary provider", () => {
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("shikimori", {
        id: "shikimori-anime",
        type: "anime",
        title: "Primary Anime",
        episodes: [{ episodeNumber: 1, title: "Primary Episode" }],
      }),
      providerDetailsResult("tmdb", {
        id: "tmdb-anime",
        type: "anime",
        title: "Secondary Anime",
        episodes: [{ episodeNumber: 1, title: "Secondary Episode" }],
      }),
    ],
    {},
  );

  assert.equal(details?.type, "anime");

  if (details === null || details.type !== "anime") {
    assert.fail("Expected anime details.");
  }

  assert.equal(details.episodes?.[0]?.title, "Primary Episode");
});

test("excludes details whose strong IDs conflict with the primary identity", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-1",
        type: "movie",
        title: "Conflict Movie",
        year: 2020,
        ids: { imdb: "tt-good" },
      }),
      providerDetailsResult("imdb", {
        id: "imdb-1",
        type: "movie",
        title: "Conflict Movie",
        year: 2021,
        ids: { imdb: "tt-conflict" },
        description: "Description from a different movie.",
        genres: [{ name: "Wrong genre" }],
      }),
    ],
    { warnings },
  );

  assert.equal(details?.year, 2020);
  assert.deepEqual(details?.ids, { imdb: "tt-good" });
  assert.equal(details?.description, undefined);
  assert.equal(details?.genres, undefined);
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["tmdb"],
  );
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging details; excluded tt-conflict.",
      provider: "imdb",
    },
  ]);
});

test("uses query strong IDs before provider priority when filtering details", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("tmdb", {
        id: "tmdb-wrong",
        type: "series",
        title: "Wrong Series",
        ids: { imdb: "tt-wrong" },
      }),
      providerDetailsResult("imdb", {
        id: "imdb-correct",
        type: "series",
        title: "Correct Series",
        ids: { imdb: "tt-correct" },
      }),
    ],
    { query: { ids: { imdb: "tt-correct" } }, warnings },
  );

  assert.equal(details?.id, "imdb-correct");
  assert.equal(details?.title, "Correct Series");
  assert.deepEqual(details?.ids, { imdb: "tt-correct" });
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting imdb IDs while merging details; excluded tt-wrong.",
      provider: "tmdb",
    },
  ]);
});

test("keeps details that share a strong ID despite another ID conflict", () => {
  const warnings: EngineWarning[] = [];
  const details = strategy.mergeDetails(
    [
      providerDetailsResult("kinobd", {
        id: "kinobd-naruto",
        type: "anime",
        title: "Наруто",
        ids: { imdb: "tt0409591", tmdb: "1062485", kinopoisk: "283290" },
      }),
      providerDetailsResult("cinemeta", {
        id: "cinemeta-naruto",
        type: "series",
        title: "Naruto",
        ids: { imdb: "tt0409591", tmdb: "46260" },
        episodesCount: 220,
      }),
    ],
    {
      query: {
        ids: { imdb: "tt0409591", tmdb: "1062485", kinopoisk: "283290" },
        type: "anime",
      },
      warnings,
    },
  );

  assert.equal(details?.type, "anime");
  assert.equal(details?.episodesCount, 220);
  assert.deepEqual(
    details?.sourceProviders?.map((source) => source.provider),
    ["kinobd", "cinemeta"],
  );
  assert.deepEqual(warnings, [
    {
      code: "EXTERNAL_ID_CONFLICT",
      message: "Conflicting tmdb IDs while merging details; kept 1062485.",
      provider: "cinemeta",
    },
  ]);
});

function providerResult(
  provider: string,
  item: MediaItem & { confidence?: number },
): ProviderSearchResult {
  const { confidence, ...mediaItem } = item;

  return {
    provider,
    item: mediaItem,
    confidence,
  };
}

function providerDetailsResult(provider: string, details: MediaDetails): ProviderDetailsResult {
  return {
    provider,
    details,
  };
}
