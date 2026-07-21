import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { ProviderError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import {
  createSearchIdentitySnapshot,
  recoverSearchIdentitySnapshot,
} from "./search-identity-snapshot.js";
import { createProvider } from "./test-helpers.js";

test("search restores a confirmed identity and order after retryable discovery degradation", async () => {
  let canonicalCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
        name: "partial-source",
        capabilities: {
          mediaTypes: ["movie", "anime"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "partial-source",
              confidence: 0.1,
              item: { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
            },
          ];
        },
      }),
      createProvider({
        name: "canonical-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          canonicalCalls += 1;

          if (canonicalCalls > 1) {
            throw new ProviderError({
              provider: "canonical-source",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Canonical discovery timed out.",
            });
          }

          return [
            {
              provider: "canonical-source",
              confidence: 1,
              item: {
                id: "dune-2021",
                type: "movie",
                title: "Dune",
                year: 2021,
                ids: { imdb: "tt1160419" },
              },
            },
          ];
        },
      }),
    ],
  });

  const healthy = await engine.search({ title: "Dune", limit: 10 });
  const degraded = await engine.search({ title: "Dune", limit: 3 });
  const repeatedDegraded = await engine.search({ title: "Dune", limit: 2 });

  assert.equal(healthy.results[0]?.item.id, "dune-2021");
  assert.deepEqual(
    degraded.results.map((result) => result.item.id),
    ["dune-2021", "dune-anime"],
  );
  assert.equal(degraded.meta.cached, false);
  assert.equal(degraded.meta.providers.failed[0]?.provider, "canonical-source");
  assert.equal(degraded.meta.providers.failed[0]?.retryable, true);
  assert.deepEqual(degraded.meta.warnings, [
    {
      code: "SEARCH_IDENTITY_SNAPSHOT_FALLBACK",
      message:
        "Restored previously confirmed search identities because mandatory discovery was retryably degraded.",
    },
  ]);
  assert.deepEqual(degraded.meta.debug?.identitySnapshot, {
    applied: true,
    restored: 1,
    reordered: 1,
  });
  assert.equal(repeatedDegraded.results[0]?.item.id, "dune-2021");
  assert.equal(repeatedDegraded.meta.cached, false);
  assert.equal(canonicalCalls, 3);
});

test("search leaves a first degraded response unchanged when no identity snapshot exists", async () => {
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
        name: "partial-source",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "partial-source",
              item: { id: "dune-anime", type: "movie", title: "Dune", year: 2017 },
            },
          ];
        },
      }),
      createProvider({
        name: "unavailable-source",
        async search(): Promise<ProviderSearchResult[]> {
          throw new ProviderError({
            provider: "unavailable-source",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            message: "Provider timed out.",
          });
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Dune" });

  assert.equal(response.results[0]?.item.id, "dune-anime");
  assert.equal(response.meta.warnings, undefined);
  assert.equal(response.meta.debug?.identitySnapshot, undefined);
});

test("search keeps a healthy snapshot stable across successful but inconsistent discovery", async () => {
  let canonicalCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
        name: "variable-source",
        capabilities: {
          mediaTypes: ["movie", "anime"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          canonicalCalls += 1;

          return [
            {
              provider: "variable-source",
              confidence: canonicalCalls === 1 ? 1 : 0.1,
              item:
                canonicalCalls === 1
                  ? {
                      id: "dune-2021",
                      type: "movie",
                      title: "Dune",
                      year: 2021,
                      ids: { imdb: "tt1160419" },
                    }
                  : { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
            },
          ];
        },
      }),
    ],
  });

  await engine.search({ title: "Dune", limit: 10 });
  const drifted = await engine.search({ title: "Dune", limit: 3 });
  const repeated = await engine.search({ title: "Dune", limit: 2 });

  assert.deepEqual(
    drifted.results.map((result) => result.item.id),
    ["dune-2021", "dune-anime"],
  );
  assert.deepEqual(drifted.meta.warnings, [
    {
      code: "SEARCH_IDENTITY_SNAPSHOT_STABILIZED",
      message: "Kept previously confirmed search identities stable across equivalent searches.",
    },
  ]);
  assert.deepEqual(drifted.meta.debug?.identitySnapshot, {
    applied: true,
    restored: 1,
    reordered: 0,
  });
  assert.equal(drifted.results[0]?.ranking?.finalPosition, 1);
  assert.equal(drifted.results[1]?.ranking?.scorePosition, 1);
  assert.equal(drifted.results[1]?.ranking?.finalPosition, 2);
  assert.equal(repeated.results[0]?.item.id, "dune-2021");
  assert.equal(repeated.meta.warnings?.[0]?.code, "SEARCH_IDENTITY_SNAPSHOT_STABILIZED");
});

test("search identity stabilization expires after thirty minutes without sliding refresh", async () => {
  let now = 0;
  let calls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache({ now: () => now, defaultTtlMs: 0 }),
    providers: [
      createProvider({
        capabilities: {
          mediaTypes: ["movie", "anime"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          return [
            {
              provider: "test-provider",
              item:
                calls === 1
                  ? {
                      id: "dune-2021",
                      type: "movie",
                      title: "Dune",
                      year: 2021,
                      ids: { imdb: "tt1160419" },
                    }
                  : { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
            },
          ];
        },
      }),
    ],
  });

  await engine.search({ title: "Dune", limit: 10 });
  now = 29 * 60_000;
  const insideWindow = await engine.search({ title: "Dune", limit: 3 });
  now = 30 * 60_000 + 1;
  const afterWindow = await engine.search({ title: "Dune", limit: 2 });

  assert.equal(insideWindow.results[0]?.item.id, "dune-2021");
  assert.equal(insideWindow.meta.warnings?.[0]?.code, "SEARCH_IDENTITY_SNAPSHOT_STABILIZED");
  assert.equal(afterWindow.results[0]?.item.id, "dune-anime");
  assert.equal(afterWindow.meta.warnings, undefined);
});

test("identity snapshots do not displace the normal response in a one-entry cache", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache({ maxEntries: 1 }),
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          return [
            {
              provider: "test-provider",
              item: {
                id: "interstellar",
                type: "movie",
                title: "Interstellar",
                year: 2014,
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
    ],
  });

  await engine.search({ title: "Interstellar" });
  const cached = await engine.search({ title: "Interstellar" });

  assert.equal(cached.meta.cached, true);
  assert.equal(calls, 1);
});

test("search does not apply or overwrite a snapshot after a non-retryable discovery failure", async () => {
  let canonicalCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    debug: true,
    providers: [
      createProvider({
        name: "partial-source",
        capabilities: {
          mediaTypes: ["movie", "anime"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "partial-source",
              item: { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
            },
          ];
        },
      }),
      createProvider({
        name: "canonical-source",
        capabilities: {
          mediaTypes: ["movie"],
          search: { byTitle: true, byExternalIds: [] },
          details: { byExternalIds: [] },
        },
        async search(): Promise<ProviderSearchResult[]> {
          canonicalCalls += 1;

          if (canonicalCalls === 2) {
            throw new ProviderError({
              provider: "canonical-source",
              code: "PROVIDER_INVALID_RESPONSE",
              retryable: false,
              message: "Provider response was invalid.",
            });
          }

          if (canonicalCalls === 3) {
            throw new ProviderError({
              provider: "canonical-source",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Provider timed out.",
            });
          }

          return [
            {
              provider: "canonical-source",
              confidence: 1,
              item: {
                id: "dune-2021",
                type: "movie",
                title: "Dune",
                year: 2021,
                ids: { imdb: "tt1160419" },
              },
            },
          ];
        },
      }),
    ],
  });

  await engine.search({ title: "Dune", limit: 10 });
  const nonRetryable = await engine.search({ title: "Dune", limit: 3 });
  const retryable = await engine.search({ title: "Dune", limit: 2 });

  assert.equal(nonRetryable.results[0]?.item.id, "dune-anime");
  assert.equal(nonRetryable.meta.debug?.identitySnapshot, undefined);
  assert.equal(nonRetryable.meta.warnings, undefined);
  assert.equal(retryable.results[0]?.item.id, "dune-2021");
  assert.equal(retryable.meta.debug?.identitySnapshot?.applied, true);
});

test("identity recovery never merges a current strong-ID conflict into a snapshot candidate", () => {
  const snapshot = createSearchIdentitySnapshot([
    {
      item: {
        id: "dune-confirmed",
        type: "movie",
        title: "Dune",
        year: 2021,
        ids: { imdb: "tt1160419" },
      },
      score: 1,
      sources: [{ provider: "confirmed-source" }],
    },
  ]);
  const conflicting = {
    item: {
      id: "dune-conflict",
      type: "movie" as const,
      title: "Dune",
      year: 2021,
      ids: { imdb: "tt9999999" },
    },
    score: 0.8,
    sources: [{ provider: "current-source" }],
  };

  const recovery = recoverSearchIdentitySnapshot([conflicting], snapshot);

  assert.deepEqual(recovery.results, [conflicting]);
  assert.equal(recovery.debug, undefined);
});

test("identity snapshots retain at most twenty known-good candidates", () => {
  const snapshot = createSearchIdentitySnapshot(
    Array.from({ length: 25 }, (_, index) => ({
      item: {
        id: `movie-${index}`,
        type: "movie" as const,
        title: `Movie ${index}`,
        year: 2000 + index,
        ids: { imdb: `tt${String(index).padStart(7, "0")}` },
      },
      score: 1 - index / 100,
      sources: [{ provider: "test-provider" }],
    })),
  );

  assert.equal(snapshot?.results.length, 20);
  assert.equal(snapshot?.results.at(-1)?.item.id, "movie-19");
});

test("identity snapshots reject a weak top candidate without a strong external ID", () => {
  const snapshot = createSearchIdentitySnapshot([
    {
      item: { id: "dune-anime", type: "anime", title: "DUNE", year: 2017 },
      score: 0.9,
      sources: [{ provider: "weak-source" }],
    },
  ]);

  assert.equal(snapshot, undefined);
});
