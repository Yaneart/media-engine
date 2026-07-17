import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "../errors/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider, sleep } from "./test-helpers.js";

test("search tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "failing-provider",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Provider is unavailable.",
          });
        },
      }),
      createProvider({
        name: "successful-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "successful-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(response.results.length, 1);
  assert.deepEqual(response.meta.providers.requested, ["failing-provider", "successful-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["successful-provider"]);
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "failing-provider",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Provider is unavailable.",
    },
  ]);
});

test("search enriches sparse top results through one external ID provider", async () => {
  let enrichmentQueries = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "title-source",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          if (!query.title) {
            return [];
          }

          return [
            {
              provider: "title-source",
              item: {
                id: "imdb:tt0388629",
                type: "series",
                title: "One Piece",
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "id-enricher",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
          features: ["ratings", "alternative_titles"],
        },
        async search(query): Promise<ProviderSearchResult[]> {
          enrichmentQueries += 1;
          assert.deepEqual(query.ids, { imdb: "tt0388629" });
          assert.equal(query.limit, 1);

          return [
            {
              provider: "id-enricher",
              item: {
                id: "kinopoisk:382731",
                type: "series",
                title: "Ван-Пис",
                alternativeTitles: ["One Piece"],
                ids: { imdb: "tt0388629", kinopoisk: "382731" },
                ratings: [{ source: "kinopoisk", value: 8.5, max: 10 }],
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "ванпис", limit: 10 });

  assert.equal(enrichmentQueries, 1);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.item.ids?.kinopoisk, "382731");
  assert.equal(response.results[0]?.item.ratings?.[0]?.value, 8.5);
  assert.deepEqual(
    response.results[0]?.sources.map((source) => source.provider),
    ["title-source", "id-enricher"],
  );
});

test("search uses the canonical details poster before returning results", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "poster-provider",
        capabilities: {
          mediaTypes: ["anime"],
          search: { byTitle: true, byExternalIds: ["shikimori"] },
          details: { byExternalIds: ["shikimori"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "poster-provider",
              item: {
                id: "anime:21",
                type: "anime",
                title: "One Piece",
                poster: { url: "https://images.example/search.jpg", type: "poster" },
                ids: { shikimori: "21" },
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          return {
            provider: "poster-provider",
            details: {
              id: "anime:21",
              type: "anime",
              title: "One Piece",
              poster: { url: "https://images.example/details.jpg", type: "poster" },
              ids: { shikimori: "21" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one", limit: 1 });

  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/details.jpg");
});

test("search reuses a provider-guaranteed poster while loading missing sources", async () => {
  let canonicalDetailsCalls = 0;
  let missingDetailsCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "canonical-source",
        searchPosterMatchesDetails: true,
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "canonical-source",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                description: "Complete search card.",
                poster: {
                  url: "https://images.example/search.jpg",
                  type: "poster",
                  source: "canonical-source",
                  width: 300,
                },
                ratings: [{ source: "imdb", value: 8.7, max: 10 }],
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          canonicalDetailsCalls += 1;
          throw new Error("Canonical search poster should be reused.");
        },
      }),
      createProvider({
        name: "missing-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: [] },
          details: { byExternalIds: ["imdb"] },
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          missingDetailsCalls += 1;
          return {
            provider: "missing-source",
            details: {
              id: "movie-1-details",
              type: "movie",
              title: "Interstellar",
              poster: {
                url: "https://images.example/missing-details.jpg",
                type: "poster",
                source: "missing-source",
                width: 900,
              },
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar", limit: 1 });

  assert.equal(canonicalDetailsCalls, 0);
  assert.equal(missingDetailsCalls, 1);
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/missing-details.jpg");
});

test("search runs ID and poster enrichment concurrently", async () => {
  let resolveIdEnrichment: ((results: ProviderSearchResult[]) => void) | undefined;
  let resolvePosterEnrichment: ((result: ProviderDetailsResult) => void) | undefined;
  let markIdEnrichmentStarted: (() => void) | undefined;
  let markPosterEnrichmentStarted: (() => void) | undefined;
  const idEnrichmentStarted = new Promise<void>((resolve) => {
    markIdEnrichmentStarted = resolve;
  });
  const posterEnrichmentStarted = new Promise<void>((resolve) => {
    markPosterEnrichmentStarted = resolve;
  });
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "title-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "title-source",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "id-enricher",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          markIdEnrichmentStarted?.();
          return new Promise((resolve) => {
            resolveIdEnrichment = resolve;
          });
        },
      }),
      createProvider({
        name: "poster-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: [] },
          details: { byExternalIds: ["imdb"] },
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          markPosterEnrichmentStarted?.();
          return new Promise((resolve) => {
            resolvePosterEnrichment = resolve;
          });
        },
      }),
    ],
  });

  const searchPromise = engine.search({ title: "Interstellar" });
  const bothStarted = await Promise.race([
    Promise.all([idEnrichmentStarted, posterEnrichmentStarted]).then(() => true),
    sleep(20).then(() => false),
  ]);

  assert.equal(bothStarted, true);
  resolveIdEnrichment?.([
    {
      provider: "id-enricher",
      item: {
        id: "movie-1-enriched",
        type: "movie",
        title: "Interstellar",
        description: "Enriched description.",
        ids: { imdb: "tt0816692" },
      },
    },
  ]);
  resolvePosterEnrichment?.({
    provider: "poster-provider",
    details: {
      id: "movie-1-details",
      type: "movie",
      title: "Interstellar",
      poster: { url: "https://images.example/poster.jpg", type: "poster" },
      ids: { imdb: "tt0816692" },
    },
  });

  const response = await searchPromise;

  assert.equal(response.results[0]?.item.description, "Enriched description.");
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/poster.jpg");
});

test("search does not retry a failed search provider for poster enrichment", async () => {
  let failedProviderDetailsCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failed-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "failed-provider",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            message: "Provider timed out.",
          });
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          failedProviderDetailsCalls += 1;
          throw new Error("Failed search provider must not be retried for a poster.");
        },
      }),
      createProvider({
        name: "successful-provider",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "successful-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
        async getDetails(): Promise<ProviderDetailsResult> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1-details",
              type: "movie",
              title: "Interstellar",
              poster: { url: "https://images.example/poster.jpg", type: "poster" },
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(failedProviderDetailsCalls, 0);
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/poster.jpg");
});

test("search enriches incomplete anime cards through a compatible series catalog", async () => {
  let receivedType: string | undefined = "not-called";
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "anime-source",
        capabilities: {
          mediaTypes: ["anime"],
          search: { byTitle: true, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          if (!query.title) return [];
          return [
            {
              provider: "anime-source",
              item: {
                id: "anime:21",
                type: "anime",
                title: "Ван-Пис",
                originalTitle: "One Piece",
                year: 1999,
                poster: { url: "https://images.example/old.jpg", type: "poster" },
                ratings: [{ source: "shikimori", value: 8.7, max: 10 }],
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
      createProvider({
        name: "kinobd",
        capabilities: {
          mediaTypes: ["series"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: ["imdb"] },
        },
        async search(query): Promise<ProviderSearchResult[]> {
          receivedType = query.type;
          return [
            {
              provider: "kinobd",
              item: {
                id: "series:tt0388629",
                type: "series",
                title: "One Piece",
                year: 1999,
                description: "Complete catalog synopsis.",
                poster: { url: "https://images.example/current.jpg", type: "poster" },
                ids: { imdb: "tt0388629" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one", limit: 1 });

  assert.equal(receivedType, undefined);
  assert.equal(response.results[0]?.item.type, "anime");
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/current.jpg");
  assert.equal(response.results[0]?.item.description, "Complete catalog synopsis.");
});
