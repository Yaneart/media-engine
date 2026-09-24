import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import type { MediaType } from "../media/index.js";
import type { IdentityClaim, IdentityIds, IdentityNamespace } from "./model.js";
import { IdentityResolver, type IdentityResolverSource } from "./resolver.js";

const imdb = "tt0816692";
const claim = (
  namespace: IdentityNamespace,
  value: string,
  ids: IdentityClaim["ids"],
  type: MediaType = "movie",
): IdentityClaim => ({
  source: "ignored",
  type,
  matched: { namespace, value },
  ids: { [namespace]: value, ...ids },
});

const source = (
  name: string,
  namespace: IdentityNamespace,
  makeClaims: (
    ids: Readonly<IdentityIds>,
  ) => readonly IdentityClaim[] | Promise<readonly IdentityClaim[]>,
): IdentityResolverSource => ({
  name,
  canResolve: (ids) => !!ids[namespace],
  resolve: async (ids) => makeClaims(ids),
});

test("resolves IMDb, TMDB, and Kinopoisk anchors through a bounded chain", async () => {
  const sources = [
    source("imdb-map", "imdb", () => [claim("imdb", imdb, { tmdb: "157336" })]),
    source("tmdb-map", "tmdb", () => [claim("tmdb", "157336", { kinopoisk: "258687" })]),
    source("kp-map", "kinopoisk", () => []),
  ];
  const resolver = new IdentityResolver(sources);
  assert.deepEqual((await resolver.resolve("movie", { imdb })).ids, {
    imdb,
    tmdb: "157336",
    kinopoisk: "258687",
  });
  assert.equal((await resolver.resolve("movie", { tmdb: "157336" })).ids.kinopoisk, "258687");
  assert.deepEqual((await resolver.resolve("movie", { kinopoisk: "258687" })).ids, {
    kinopoisk: "258687",
  });
});

test("withholds conflicting IDs, accepts agreement, and isolates source errors", async () => {
  const resolver = new IdentityResolver([
    source("a", "imdb", () => [claim("imdb", imdb, { tmdb: "157336" })]),
    source("b", "imdb", () => [claim("imdb", imdb, { tmdb: "999" })]),
    source("bad", "imdb", () => {
      throw new Error("offline");
    }),
  ]);
  const result = await resolver.resolve("movie", { imdb });
  assert.deepEqual(result.ids, { imdb });
  assert.deepEqual(result.diagnostics.map((item) => item.code).sort(), [
    "AMBIGUOUS_ID",
    "SOURCE_ERROR",
  ]);
  const agreed = new IdentityResolver([
    source("a", "imdb", () => [claim("imdb", imdb, { tmdb: "157336" })]),
    source("b", "imdb", () => [claim("imdb", imdb, { tmdb: "157336" })]),
  ]);
  assert.equal((await agreed.resolve("movie", { imdb })).ids.tmdb, "157336");
});

test("withholds a derived ID when a later source disputes it", async () => {
  const resolver = new IdentityResolver([
    source("first", "imdb", () => [claim("imdb", imdb, { tmdb: "157336", kinopoisk: "258687" })]),
    source("second", "tmdb", () => [claim("tmdb", "157336", { kinopoisk: "999" })]),
  ]);
  const result = await resolver.resolve("movie", { imdb });
  assert.equal(result.ids.tmdb, "157336");
  assert.equal(result.ids.kinopoisk, undefined);
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === "AMBIGUOUS_ID" && item.namespace === "kinopoisk",
    ),
  );
});

test("limits passes and calls even when sources form a cycle", async () => {
  let calls = 0;
  const resolver = new IdentityResolver(
    [
      source("a", "imdb", () => {
        calls++;
        return [claim("imdb", imdb, { tmdb: "157336" })];
      }),
      source("b", "tmdb", () => {
        calls++;
        return [claim("tmdb", "157336", { imdb })];
      }),
    ],
    { maxPasses: 2, maxCalls: 2 },
  );
  const result = await resolver.resolve("movie", { imdb });
  assert.equal(result.ids.tmdb, "157336");
  assert.equal(calls, 2);
  assert.ok(result.diagnostics.some((item) => item.code === "BUDGET_EXHAUSTED"));
});

test("times out one source without blocking another", async () => {
  const resolver = new IdentityResolver(
    [
      source("slow", "imdb", () => new Promise(() => {})),
      source("ready", "imdb", () => [claim("imdb", imdb, { tmdb: "157336" })]),
    ],
    { sourceTimeoutMs: 15, timeoutMs: 50 },
  );
  const result = await resolver.resolve("movie", { imdb });
  assert.equal(result.ids.tmdb, "157336");
  assert.ok(result.diagnostics.some((item) => item.code === "SOURCE_TIMEOUT"));
});

test("caches positive and empty results and deduplicates simultaneous calls", async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const resolver = new IdentityResolver(
    [
      source("lookup", "imdb", async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [claim("imdb", imdb, { tmdb: "157336" })];
      }),
      source("empty", "imdb", () => {
        calls++;
        return [];
      }),
    ],
    { cache },
  );
  await Promise.all([resolver.resolve("movie", { imdb }), resolver.resolve("movie", { imdb })]);
  await resolver.resolve("movie", { imdb });
  assert.equal(calls, 4);
});

test("caller cancellation returns partial IDs without poisoning shared work", async () => {
  const controller = new AbortController();
  const resolver = new IdentityResolver([
    source("lookup", "imdb", async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return [claim("imdb", imdb, { tmdb: "157336" })];
    }),
  ]);
  const cancelled = resolver.resolve("movie", { imdb }, controller.signal);
  const continuing = resolver.resolve("movie", { imdb });
  controller.abort();
  assert.deepEqual((await cancelled).ids, { imdb });
  assert.equal((await continuing).ids.tmdb, "157336");
});
