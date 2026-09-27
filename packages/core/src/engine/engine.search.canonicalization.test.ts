import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentityResolver, type IdentityResolverSource } from "../identity/index.js";
import type { ExternalIds, MediaItem, MediaType } from "../media/index.js";
import type { MediaProvider, ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

const deathNoteIds = {
  imdb: "tt0877057",
  kinopoisk: "406148",
  aniList: "1535",
  myAnimeList: "1535",
  shikimori: "1535",
};
const gameOfThronesIds = { imdb: "tt0944947", kinopoisk: "464963" };

const mapping: IdentityResolverSource = {
  name: "verified-map",
  canResolve(ids) {
    return Boolean(ids.aniList || ids.shikimori || ids.myAnimeList || ids.imdb || ids.kinopoisk);
  },
  async resolve(ids, type) {
    const resolved = resolveIds(ids);
    const matched = Object.entries(ids).find(([, value]) => Boolean(value));

    return resolved && matched
      ? [
          {
            source: "verified-map",
            type,
            matched: { namespace: matched[0] as keyof ExternalIds, value: matched[1]! },
            ids: Object.fromEntries(Object.entries(resolved)),
          },
        ]
      : [];
  },
};

test("canonicalizes Death Note aliases before limit while keeping adaptations separate", async () => {
  for (const providers of providerOrders(createDeathNoteProviders())) {
    const engine = new MediaEngine({
      identityResolver: new IdentityResolver([mapping]),
      providers,
    });

    for (const title of ["Death Note", "Тетрадь смерти"]) {
      const first = await engine.search({ title, limit: 1 });
      const expanded = await engine.search({ title, limit: 10 });

      assert.equal(first.results[0]?.item.type, "anime");
      assert.equal(first.results[0]?.item.ids?.imdb, deathNoteIds.imdb);
      assert.equal(countIdentity(expanded.results, deathNoteIds.imdb), 1);
      assert.equal(countIdentity(expanded.results, "tt1241317"), 1);
      assert.equal(countIdentity(expanded.results, "tt9999999"), 1);
    }
  }
});

test("canonicalizes Russian and English Game of Thrones cards into one identity", async () => {
  for (const providers of providerOrders(createGameOfThronesProviders())) {
    const engine = new MediaEngine({
      identityResolver: new IdentityResolver([mapping]),
      providers,
    });

    for (const title of ["Game of Thrones", "Игра престолов"]) {
      const response = await engine.search({ title, limit: 5 });

      assert.equal(countIdentity(response.results, gameOfThronesIds.imdb), 1);
      assert.equal(response.results[0]?.item.ids?.kinopoisk, gameOfThronesIds.kinopoisk);
    }
  }
});

function createDeathNoteProviders(): MediaProvider[] {
  return [
    catalog("anilist", [
      item("anilist-death-note", "anime", "Death Note", 2006, { aniList: "1535" }, 2_900_000),
      {
        ...item(
          "anilist-remake",
          "anime",
          "Death Note: Reborn",
          2027,
          { aniList: "99999" },
          20_000,
        ),
        alternativeTitles: ["Тетрадь смерти: Перерождение"],
      },
    ]),
    catalog("shikimori", [
      item("shikimori-death-note", "anime", "Тетрадь смерти", 2006, { shikimori: "1535" }, 900_000),
      {
        ...item(
          "death-note-live-action",
          "movie",
          "Death Note",
          2017,
          { imdb: "tt1241317" },
          96_000,
        ),
        alternativeTitles: ["Тетрадь смерти"],
      },
    ]),
  ];
}

function createGameOfThronesProviders(): MediaProvider[] {
  return [
    catalog("cinemeta", [
      item("got-imdb", "series", "Game of Thrones", 2011, { imdb: "tt0944947" }, 2_400_000),
    ]),
    catalog("kinobd", [
      item("got-kp", "series", "Игра престолов", 2011, { kinopoisk: "464963" }, 1_000_000),
    ]),
  ];
}

function catalog(name: string, items: MediaItem[]): MediaProvider {
  return createProvider({
    name,
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      search: { byTitle: true, byExternalIds: [] },
      details: { byExternalIds: [] },
    },
    async search(): Promise<ProviderSearchResult[]> {
      return items.map((item) => ({ provider: name, item }));
    },
  });
}

function item(
  id: string,
  type: MediaType,
  title: string,
  year: number,
  ids: ExternalIds,
  votes: number,
): MediaItem {
  return {
    id,
    type,
    title,
    year,
    ids,
    description: `${title} description`,
    poster: { type: "poster", url: `https://images.example/${id}.jpg` },
    ratings: [{ source: "imdb", value: 8, max: 10, votes }],
  };
}

function providerOrders(providers: MediaProvider[]): MediaProvider[][] {
  return [providers, [...providers].reverse()];
}

function countIdentity(results: Array<{ item: MediaItem }>, imdb: string): number {
  return results.filter((result) => result.item.ids?.imdb === imdb).length;
}

function resolveIds(ids: ExternalIds): ExternalIds | undefined {
  if (
    ids.aniList === deathNoteIds.aniList ||
    ids.myAnimeList === deathNoteIds.myAnimeList ||
    ids.shikimori === deathNoteIds.shikimori ||
    ids.imdb === deathNoteIds.imdb ||
    ids.kinopoisk === deathNoteIds.kinopoisk
  ) {
    return deathNoteIds;
  }

  if (ids.aniList === "99999") {
    return { aniList: "99999", imdb: "tt9999999" };
  }

  if (ids.imdb === gameOfThronesIds.imdb || ids.kinopoisk === gameOfThronesIds.kinopoisk) {
    return gameOfThronesIds;
  }

  return undefined;
}
