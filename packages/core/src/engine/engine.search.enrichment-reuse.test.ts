import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("search reuses cached details fields without another provider call", async () => {
  let detailsCalls = 0;
  let idSearchCalls = 0;
  const engine = createDetailsReuseEngine({
    onIdSearch: () => {
      idSearchCalls += 1;
    },
    loadDetails: async () => {
      detailsCalls += 1;
      return createCompleteDetails();
    },
  });
  const detailsQuery = createDetailsQuery();

  await engine.getDetails(detailsQuery);
  const response = await engine.search({ title: "Interstellar", limit: 1 });

  assert.equal(detailsCalls, 1);
  assert.equal(idSearchCalls, 0);
  assert.equal(response.results[0]?.item.poster?.url, "https://images.example/details.jpg");
  assert.equal(response.results[0]?.item.description, "Complete cached details.");
  assert.equal(response.meta.debug?.enrichment?.poster.attempted, 0);
});

test("search joins in-flight details without duplicate provider work", async () => {
  let detailsCalls = 0;
  let idSearchCalls = 0;
  let markDetailsStarted: (() => void) | undefined;
  let resolveDetails: ((result: ProviderDetailsResult) => void) | undefined;
  const detailsStarted = new Promise<void>((resolve) => {
    markDetailsStarted = resolve;
  });
  const engine = createDetailsReuseEngine({
    onIdSearch: () => {
      idSearchCalls += 1;
    },
    loadDetails: async () => {
      detailsCalls += 1;
      markDetailsStarted?.();
      return new Promise<ProviderDetailsResult>((resolve) => {
        resolveDetails = resolve;
      });
    },
  });

  const detailsPromise = engine.getDetails(createDetailsQuery());
  await detailsStarted;
  const searchPromise = engine.search({ title: "Interstellar", limit: 1 });
  await Promise.resolve();
  resolveDetails?.(createCompleteDetails());
  const [, search] = await Promise.all([detailsPromise, searchPromise]);

  assert.equal(detailsCalls, 1);
  assert.equal(idSearchCalls, 0);
  assert.equal(search.results[0]?.item.poster?.url, "https://images.example/details.jpg");
  assert.equal(search.meta.debug?.enrichment?.poster.attempted, 0);
});

function createDetailsQuery() {
  return {
    type: "movie" as const,
    ids: { imdb: "tt0816692" },
    language: "en",
  };
}

function createCompleteDetails(): ProviderDetailsResult {
  return {
    provider: "details-source",
    details: {
      id: "details-1",
      type: "movie",
      title: "Interstellar",
      description: "Complete cached details.",
      poster: { url: "https://images.example/details.jpg", type: "poster" },
      ratings: [{ source: "imdb", value: 8.7, max: 10 }],
      ids: { imdb: "tt0816692" },
    },
  };
}

function createDetailsReuseEngine(input: {
  onIdSearch(): void;
  loadDetails(): Promise<ProviderDetailsResult>;
}): MediaEngine {
  return new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
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
        name: "details-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: [] },
          details: { byExternalIds: ["imdb"] },
          features: ["posters"],
        },
        getDetails: input.loadDetails,
      }),
      createProvider({
        name: "id-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: false, byExternalIds: ["imdb"] },
          details: { byExternalIds: [] },
          features: ["ratings"],
        },
        async search(): Promise<ProviderSearchResult[]> {
          input.onIdSearch();
          return [];
        },
      }),
    ],
  });
}
