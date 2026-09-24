import assert from "node:assert/strict";
import { test } from "node:test";

import { IdentityResolver, type IdentityResolverSource } from "../identity/index.js";
import { MemoryCache } from "../cache/index.js";
import { DefaultMergeStrategy } from "../merge/index.js";
import { resolveSearchIdentities } from "./identity-integration.js";
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
  const details = await engine.getDetails({ type: "movie", ids: { imdb: "tt0816692" } });
  const availability = await engine.getAvailability({ type: "movie", ids: { imdb: "tt0816692" } });
  assert.equal(details.details?.ids?.kinopoisk, "258687");
  assert.equal(availability.query.ids?.kinopoisk, "258687");
  assert.deepEqual(received, ["258687"]);
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
