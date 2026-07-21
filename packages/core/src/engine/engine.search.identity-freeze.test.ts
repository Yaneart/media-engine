import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import type { MediaProvider, ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createSearchIdentitySnapshotCacheKey } from "./query.js";
import type { SearchIdentitySnapshot } from "./search-identity-snapshot.js";
import { createProvider } from "./test-helpers.js";

test("optional enrichment cannot rerank frozen discovery identities", async () => {
  const catalog = createDuneCatalog();
  const engine = new MediaEngine({
    providers: [
      catalog,
      createProvider({
        name: "ratings-enricher",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["ratings"],
        },
        async search(query): Promise<ProviderSearchResult[]> {
          const imdb = query.ids?.imdb;

          if (!imdb) {
            return [];
          }

          const isSecond = imdb === "tt-second";
          return [
            {
              provider: "ratings-enricher",
              confidence: 1,
              item: {
                id: `enriched-${imdb}`,
                type: "movie",
                title: "Dune",
                description: "Optional presentation metadata.",
                ratings: [
                  {
                    source: "imdb",
                    value: isSecond ? 9.9 : 5,
                    max: 10,
                    votes: isSecond ? 10_000_000 : 10,
                  },
                ],
                ids: { imdb },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Dune", limit: 2 });

  assert.deepEqual(
    response.results.map((result) => result.item.id),
    ["discovery-first", "discovery-second"],
  );
  assert.ok(response.results[0]!.score > response.results[1]!.score);
  assert.equal(response.results[1]!.item.ratings?.[0]?.votes, 10_000_000);
});

test("optional enrichment preserves frozen identity fields and conflicting discovery IDs", async () => {
  const baseline = await new MediaEngine({ providers: [createIdentityCatalog()] }).search({
    title: "Dune",
    limit: 1,
  });
  const engine = new MediaEngine({
    providers: [createIdentityCatalog(), createIdentityEnricher()],
  });

  const response = await engine.search({ title: "Dune", limit: 1 });
  const result = response.results[0]!;
  const baselineResult = baseline.results[0]!;

  assert.deepEqual(
    {
      id: result.item.id,
      type: result.item.type,
      title: result.item.title,
      originalTitle: result.item.originalTitle,
      year: result.item.year,
      score: result.score,
    },
    {
      id: "catalog-dune",
      type: "movie",
      title: "Dune",
      originalTitle: "Dune: Part One",
      year: 2021,
      score: baselineResult.score,
    },
  );
  assert.deepEqual(result.item.ids, {
    imdb: "tt1160419",
    kinopoisk: "409118",
    tmdb: "438631",
  });
  assert.equal(result.item.description, "Enriched description.");
  assert.equal(result.item.poster?.url, "https://images.example/enriched.jpg");
  assert.equal(result.item.ratings?.[0]?.votes, 500_000);
  assert.deepEqual(
    result.sources.map((source) => source.provider),
    ["catalog", "presentation-enricher"],
  );
  assert.ok(
    response.meta.warnings?.some(
      (warning) =>
        warning.code === "EXTERNAL_ID_CONFLICT" && warning.provider === "presentation-enricher",
    ) ?? false,
  );
});

test("identity snapshots store mandatory discovery before optional presentation enrichment", async () => {
  const cache = new MemoryCache();
  const query = { title: "Dune", limit: 1 };
  const engine = new MediaEngine({
    cache,
    providers: [createIdentityCatalog(), createIdentityEnricher()],
  });

  const response = await engine.search(query);
  const snapshot = cache.get<SearchIdentitySnapshot>(createSearchIdentitySnapshotCacheKey(query));
  const snapshotResult = snapshot?.results[0];

  assert.equal(response.results[0]?.item.description, "Enriched description.");
  assert.equal(snapshot?.version, 2);
  assert.equal(snapshotResult?.item.id, "catalog-dune");
  assert.equal(snapshotResult?.item.description, undefined);
  assert.equal(snapshotResult?.item.poster, undefined);
  assert.equal(snapshotResult?.item.ratings, undefined);
  assert.deepEqual(snapshotResult?.item.ids, {
    imdb: "tt1160419",
    kinopoisk: "409118",
  });
  assert.deepEqual(
    snapshotResult?.sources.map((source) => source.provider),
    ["catalog"],
  );
});

test("optional enrichment keeps a higher-resolution discovery poster", async () => {
  const catalog = createIdentityCatalog();
  const originalSearch = catalog.search.bind(catalog);
  catalog.search = async (query, context) => {
    const results = await originalSearch(query, context);
    results[0]!.item.poster = {
      url: "https://images.example/discovery-large.jpg",
      type: "poster",
      width: 2_000,
      height: 3_000,
    };
    return results;
  };
  const enricher = createIdentityEnricher();
  const originalEnrichmentSearch = enricher.search.bind(enricher);
  enricher.search = async (query, context) => {
    const results = await originalEnrichmentSearch(query, context);
    results[0]!.item.poster = {
      url: "https://images.example/enrichment-small.jpg",
      type: "poster",
      width: 200,
      height: 300,
    };
    return results;
  };
  const engine = new MediaEngine({ providers: [catalog, enricher] });

  const response = await engine.search({ title: "Dune", limit: 1 });

  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/discovery-large.jpg");
});

function createDuneCatalog(): MediaProvider {
  return createProvider({
    name: "catalog",
    capabilities: {
      mediaTypes: ["movie"],
      search: { byTitle: true, byExternalIds: [] },
      details: { byExternalIds: [] },
    },
    async search(): Promise<ProviderSearchResult[]> {
      return [
        {
          provider: "catalog",
          confidence: 0.6,
          item: {
            id: "discovery-first",
            type: "movie",
            title: "Dune",
            year: 2021,
            ids: { imdb: "tt-first" },
          },
        },
        {
          provider: "catalog",
          confidence: 0.5,
          item: {
            id: "discovery-second",
            type: "movie",
            title: "Dune",
            year: 2021,
            ids: { imdb: "tt-second" },
          },
        },
      ];
    },
  });
}

function createIdentityCatalog(): MediaProvider {
  return createProvider({
    name: "catalog",
    capabilities: {
      mediaTypes: ["movie"],
      search: { byTitle: true, byExternalIds: [] },
      details: { byExternalIds: [] },
    },
    async search(): Promise<ProviderSearchResult[]> {
      return [
        {
          provider: "catalog",
          item: {
            id: "catalog-dune",
            type: "movie",
            title: "Dune",
            originalTitle: "Dune: Part One",
            year: 2021,
            ids: { imdb: "tt1160419", kinopoisk: "409118" },
          },
        },
      ];
    },
  });
}

function createIdentityEnricher(): MediaProvider {
  return createProvider({
    name: "presentation-enricher",
    capabilities: {
      mediaTypes: ["movie"],
      search: { byTitle: false, byExternalIds: ["imdb"] },
      details: { byExternalIds: [] },
      features: ["posters", "ratings"],
    },
    async search(): Promise<ProviderSearchResult[]> {
      return [
        {
          provider: "presentation-enricher",
          item: {
            id: "wrong-provider-id",
            type: "movie",
            title: "Wrong title",
            originalTitle: "Wrong original title",
            year: 1984,
            description: "Enriched description.",
            poster: { url: "https://images.example/enriched.jpg", type: "poster" },
            ratings: [{ source: "imdb", value: 8.5, max: 10, votes: 500_000 }],
            ids: {
              imdb: "tt1160419",
              kinopoisk: "conflicting-kinopoisk",
              tmdb: "438631",
            },
          },
        },
      ];
    },
  });
}
