import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentityResolver, type IdentityResolverSource } from "../identity/index.js";
import { MemoryCache } from "../cache/index.js";
import { DefaultMergeStrategy } from "../merge/index.js";
import {
  resolveItemIdentity,
  resolveQueryIdentity,
  resolveSearchIdentities,
} from "./identity-integration.js";
import type { EngineWarning } from "../response/index.js";
import type { MediaAvailability } from "../streaming/index.js";
import { MediaEngine } from "./engine.js";
import {
  createAvailability,
  createProvider,
  createStreamingProvider,
  createTorrentProvider,
  createTorrentResponse,
} from "./test-helpers.js";

const mapping: IdentityResolverSource = {
  name: "verified-map",
  canResolve: (ids, type) => type === "movie" && Boolean(ids.imdb),
  async resolve(ids) {
    if (ids.imdb !== "tt0816692") return [];
    return [
      {
        source: "verified-map",
        type: "movie",
        matched: { namespace: "imdb", value: "tt0816692" },
        ids: { imdb: "tt0816692", kinopoisk: "258687", tmdb: "157336" },
      },
    ];
  },
};

const animeIds = {
  imdb: "tt0877057",
  shikimori: "1535",
  myAnimeList: "1535",
  aniList: "1535",
} as const;

const animeAliasMapping: IdentityResolverSource = {
  name: "verified-anime-map",
  canResolve: (ids, type) =>
    type === "anime" &&
    Object.entries(animeIds).some(
      ([source, value]) => ids[source as keyof typeof animeIds] === value,
    ),
  async resolve(ids) {
    const matched = ids.aniList
      ? { namespace: "aniList" as const, value: ids.aniList }
      : ids.shikimori
        ? { namespace: "shikimori" as const, value: ids.shikimori }
        : ids.myAnimeList
          ? { namespace: "myAnimeList" as const, value: ids.myAnimeList }
          : { namespace: "imdb" as const, value: ids.imdb! };

    return [
      {
        source: "verified-anime-map",
        type: "anime",
        matched,
        ids: animeIds,
      },
    ];
  },
};

test("search resolves visible cards and reunites a verified split identity", async () => {
  const engine = new MediaEngine({
    identityResolver: new IdentityResolver([mapping]),
    providers: [
      createProvider({
        async search() {
          return [
            {
              provider: "test-provider",
              item: {
                id: "imdb-card",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
            {
              provider: "test-provider",
              item: {
                id: "kp-card",
                type: "movie",
                title: "Interstellar",
                ids: { kinopoisk: "258687" },
              },
            },
          ];
        },
      }),
    ],
  });
  const response = await engine.search({ title: "Interstellar", limit: 2 });
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.item.ids?.kinopoisk, "258687");
  assert.equal(response.results[0]?.item.ids?.imdb, "tt0816692");
});

test("details and ID-only availability receive the same verified identity", async () => {
  const received: string[] = [];
  const engine = new MediaEngine({
    identityResolver: new IdentityResolver([mapping]),
    providers: [
      createProvider({
        async getDetails() {
          return {
            provider: "test-provider",
            details: {
              id: "imdb-card",
              type: "movie",
              title: "Interstellar",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
    streamingProviders: [
      createStreamingProvider({
        name: "kp-player",
        capabilities: {
          mediaTypes: ["movie"],
          lookup: { byTitle: false, byExternalIds: ["kinopoisk"], byEpisode: false },
        },
        async getAvailability(query): Promise<MediaAvailability> {
          received.push(query.ids?.kinopoisk ?? "missing");
          return createAvailability(query, "kp-player");
        },
      }),
    ],
  });
  const details = await engine.getDetails({ ids: { imdb: "tt0816692" } });
  const detailsBeforeAvailability = structuredClone(details.details);
  const availability = await engine.getAvailability({ type: "movie", ids: { imdb: "tt0816692" } });
  assert.equal(details.query.type, "movie");
  assert.equal(details.details?.ids?.kinopoisk, "258687");
  assert.equal(availability.query.ids?.kinopoisk, "258687");
  assert.deepEqual(details.details, detailsBeforeAvailability);
  assert.deepEqual(received, ["258687"]);
});

test("details resolve aliases before provider selection and share one canonical cache entry", async () => {
  const calls = new Map<string, number>();
  const localizedDetails = {
    id: "death-note",
    type: "anime" as const,
    title: "Тетрадь смерти",
    originalTitle: "Death Note",
    description: "Лайт Ягами находит тетрадь, способную убивать людей.",
    genres: [{ name: "аниме" }, { name: "триллер" }],
    ids: animeIds,
  };
  const { genres: _localizedGenres, ...sharedDetails } = localizedDetails;
  const englishDetails = {
    ...sharedDetails,
    title: "Death Note",
    description: "Light Yagami finds a notebook with a deadly power.",
  };
  const provider = (
    name: string,
    source: "imdb" | "shikimori" | "aniList",
    details = englishDetails,
  ) =>
    createProvider({
      name,
      capabilities: {
        mediaTypes: ["anime"],
        search: { byTitle: false, byExternalIds: [source] },
        details: { byExternalIds: [source] },
      },
      async getDetails(query) {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        assert.deepEqual(query.ids, animeIds);
        return { provider: name, details };
      },
    });
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    identityResolver: new IdentityResolver([animeAliasMapping]),
    providers: [
      provider("localized-anime", "shikimori", localizedDetails),
      provider("anime-catalog", "aniList"),
      provider("cinema-catalog", "imdb"),
    ],
  });

  const first = await engine.getDetails({
    language: "ru",
    ids: { aniList: animeIds.aniList },
  });
  const second = await engine.getDetails({
    language: "ru",
    ids: { shikimori: animeIds.shikimori },
  });
  const third = await engine.getDetails({
    language: "ru",
    ids: { imdb: animeIds.imdb },
  });

  assert.deepEqual(first.meta.providers.requested, [
    "localized-anime",
    "anime-catalog",
    "cinema-catalog",
  ]);
  assert.equal(first.query.type, "anime");
  assert.deepEqual(first.query.ids, animeIds);
  assert.deepEqual(second.query, first.query);
  assert.deepEqual(third.query, first.query);
  assert.deepEqual(second.details, first.details);
  assert.deepEqual(third.details, first.details);
  assert.equal(first.details?.title, "Тетрадь смерти");
  assert.equal(first.details?.description, "Лайт Ягами находит тетрадь, способную убивать людей.");
  assert.deepEqual(first.details?.genres, [{ name: "аниме" }, { name: "триллер" }]);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(third.meta.cached, true);
  assert.deepEqual(Object.fromEntries(calls), {
    "localized-anime": 1,
    "anime-catalog": 1,
    "cinema-catalog": 1,
  });
});

test("details report identity source failures and do not cache the incomplete identity", async () => {
  let detailsCalls = 0;
  let mappingAvailable = true;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    identityResolver: new IdentityResolver([
      {
        name: "unavailable-map",
        canResolve: (_ids, type) => type === "movie",
        async resolve() {
          if (!mappingAvailable) throw new Error("Mapping unavailable");
          return [
            {
              source: "unavailable-map",
              type: "movie",
              matched: { namespace: "imdb", value: "tt0816692" },
              ids: { imdb: "tt0816692" },
            },
          ];
        },
      },
    ]),
    providers: [
      createProvider({
        async getDetails() {
          detailsCalls += 1;
          return {
            provider: "test-provider",
            details: {
              id: "imdb-card",
              type: "movie",
              title: "Interstellar",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const first = await engine.getDetails({ type: "movie", ids: { imdb: "tt0816692" } });
  mappingAvailable = false;
  const second = await engine.getDetails({ type: "movie", ids: { imdb: "tt0816692" } });

  assert.equal(first.meta.cached, false);
  assert.equal(
    second.meta.warnings?.some(({ code }) => code === "SOURCE_ERROR"),
    true,
  );
  assert.equal(second.meta.cached, false);
  assert.equal(detailsCalls, 2);
});

test("untyped details do not guess when more than one media type is confirmed", async () => {
  const source: IdentityResolverSource = {
    name: "ambiguous-type-map",
    canResolve: (ids, type) => type !== "anime" && ids.imdb === "tt0816692",
    async resolve(ids, type) {
      return [
        {
          source: "ambiguous-type-map",
          type,
          matched: { namespace: "imdb", value: ids.imdb! },
          ids,
        },
      ];
    },
  };
  const query = { ids: { imdb: "tt0816692" } };

  assert.equal(await resolveQueryIdentity(query, new IdentityResolver([source])), query);
});

test("search identity work is bounded and conflicting IDs stay separate", async () => {
  let calls = 0;
  const source: IdentityResolverSource = {
    name: "bounded-map",
    canResolve: (ids) => Boolean(ids.imdb),
    async resolve() {
      calls += 1;
      return [];
    },
  };
  const results = Array.from({ length: 8 }, (_, index) => ({
    item: {
      id: `card-${index}`,
      type: "movie" as const,
      title: `Film ${index}`,
      ids: {
        imdb: `tt${String(index + 1).padStart(7, "0")}`,
        ...(index === 1 ? { kinopoisk: "999" } : {}),
      },
    },
    score: 1,
    sources: [{ provider: `provider-${index}` }],
  }));
  const merged = await resolveSearchIdentities(
    results,
    new IdentityResolver([source]),
    undefined,
    [],
    new DefaultMergeStrategy(),
  );
  assert.equal(calls, 5);
  assert.equal(
    merged.some((result) => result.item.ids?.kinopoisk === "999"),
    true,
  );
  assert.equal(merged.length, 8);
  const conflicting = await resolveSearchIdentities(
    [
      {
        ...results[0]!,
        item: { ...results[0]!.item, ids: { imdb: "tt0816692", kinopoisk: "258687" } },
      },
      {
        ...results[1]!,
        item: { ...results[1]!.item, ids: { imdb: "tt0816692", kinopoisk: "999" } },
      },
    ],
    new IdentityResolver([mapping]),
    undefined,
    [],
    new DefaultMergeStrategy(),
  );
  assert.equal(conflicting.length, 2);
});

test("torrent discovery uses a verified ID when a provider needs it", async () => {
  const engine = new MediaEngine({
    identityResolver: new IdentityResolver([mapping]),
    torrentProviders: [
      createTorrentProvider({
        name: "kp-torrent",
        capabilities: {
          mediaTypes: ["movie"],
          lookup: { byTitle: false, byExternalIds: ["kinopoisk"], byEpisode: false },
        },
        async discoverTorrents(query) {
          assert.equal(query.ids?.kinopoisk, "258687");
          return createTorrentResponse(query, "kp-torrent");
        },
      }),
    ],
  });
  const response = await engine.discoverTorrents({ type: "movie", ids: { imdb: "tt0816692" } });
  assert.equal(response.query.ids?.kinopoisk, "258687");
  assert.equal(response.candidates.length, 1);
});

test("a mapping timeout warns without hiding results or caching the incomplete search", async () => {
  let calls = 0;
  const stalled: IdentityResolverSource = {
    name: "stalled-map",
    canResolve: (ids) => Boolean(ids.imdb),
    async resolve() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [];
    },
  };
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    identityResolver: new IdentityResolver([stalled], { sourceTimeoutMs: 5, timeoutMs: 20 }),
    providers: [
      createProvider({
        async search() {
          return [
            {
              provider: "test-provider",
              item: {
                id: "card",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
    ],
  });
  const first = await engine.search({ title: "Interstellar", limit: 1 });
  const second = await engine.search({ title: "Interstellar", limit: 1 });
  assert.equal(first.results.length, 1);
  assert.equal(
    first.meta.warnings?.some(({ code }) => code === "SOURCE_TIMEOUT"),
    true,
  );
  assert.equal(second.meta.cached, false);
  assert.equal(calls, 2);
});

test("optional identity resolution preserves input and deduplicates source warnings", async () => {
  const item = { id: "card", type: "movie" as const, title: "Film", ids: { imdb: "tt0816692" } };
  const query = { type: "movie" as const, ids: { imdb: "tt0816692" } };
  assert.equal(await resolveItemIdentity(item, undefined), item);
  assert.equal(await resolveQueryIdentity(query, undefined), query);
  const itemWithoutIds = { id: "empty", type: "movie" as const, title: "Unknown" };
  const queryWithoutIds = { type: "movie" as const };
  assert.equal(
    await resolveItemIdentity(itemWithoutIds, new IdentityResolver([mapping])),
    itemWithoutIds,
  );
  assert.equal(
    await resolveQueryIdentity(queryWithoutIds, new IdentityResolver([mapping])),
    queryWithoutIds,
  );
  assert.deepEqual((await resolveQueryIdentity(query, new IdentityResolver([mapping]))).ids, {
    imdb: "tt0816692",
    kinopoisk: "258687",
    tmdb: "157336",
  });
  const searchResults = [{ item, score: 1, sources: [{ provider: "test-provider" }] }];
  assert.equal(
    await resolveSearchIdentities(
      searchResults,
      undefined,
      undefined,
      [],
      new DefaultMergeStrategy(),
    ),
    searchResults,
  );

  const failing: IdentityResolverSource = {
    name: "failing-map",
    canResolve: () => true,
    async resolve() {
      throw new Error("Mapping unavailable");
    },
  };
  const resolver = new IdentityResolver([failing]);
  assert.deepEqual((await resolveItemIdentity(item, resolver)).ids, item.ids);
  const warnings: EngineWarning[] = [];
  assert.deepEqual((await resolveItemIdentity(item, resolver, undefined, warnings)).ids, item.ids);
  await resolveItemIdentity(item, resolver, undefined, warnings);
  assert.deepEqual(
    warnings.map(({ code, provider }) => [code, provider]),
    [["SOURCE_ERROR", "failing-map"]],
  );
});
