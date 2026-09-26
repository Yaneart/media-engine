import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CanonicalIdentityIndex,
  createWorkKey,
  formatIdentityAlias,
  parseIdentityAlias,
  type WorkKey,
} from "./canonical.js";

const keys = (...values: string[]): (() => WorkKey) => {
  let index = 0;
  return () => values[index++] as WorkKey;
};

test("keeps one provider-independent work key as aliases arrive in any order", () => {
  for (const inputs of [
    [{ imdb: "TT0816692" }, { imdb: "tt0816692", tmdb: "157336", kinopoisk: "258687" }],
    [
      { kinopoisk: "258687", imdb: "tt0816692" },
      { tmdb: "157336", imdb: "tt0816692" },
    ],
    [{ tmdb: "157336", kinopoisk: "258687", imdb: "tt0816692" }, { imdb: "tt0816692" }],
  ]) {
    const registry = new CanonicalIdentityIndex(keys("work_fixed"));
    const first = registry.resolveOrCreate("movie", inputs[0]!);
    const second = registry.resolveOrCreate("movie", inputs[1]!);
    assert.equal(first.status, "created");
    assert.equal(second.status, "resolved");
    assert.equal(first.identity.workKey, "work_fixed");
    assert.equal(second.identity.workKey, "work_fixed");
    assert.deepEqual(second.identity.aliases, [
      "imdb:tt0816692",
      "kinopoisk:258687",
      "tmdb:157336",
    ]);
  }
});

test("does not merge aliases that already identify different works", () => {
  const registry = new CanonicalIdentityIndex(keys("work_a", "work_b"));
  registry.resolveOrCreate("anime", { aniList: "1535" });
  registry.resolveOrCreate("anime", { shikimori: "1535" });

  const result = registry.resolveOrCreate("anime", { aniList: "1535", shikimori: "1535" });

  assert.deepEqual(result, {
    status: "conflict",
    conflict: {
      code: "CANONICAL_IDENTITY_CONFLICT",
      aliases: ["aniList:1535", "shikimori:1535"],
      workKeys: ["work_a", "work_b"],
    },
  });
  assert.equal(registry.resolve("aniList:1535")?.workKey, "work_a");
  assert.equal(registry.resolve("shikimori:1535")?.workKey, "work_b");
});

test("rejects a conflicting mapping without mutating the known identity", () => {
  const registry = new CanonicalIdentityIndex(keys("work_a"));
  registry.resolveOrCreate("movie", { imdb: "tt0816692", tmdb: "157336" });

  const result = registry.resolveOrCreate("movie", { imdb: "tt0816692", tmdb: "999" });

  assert.equal(result.status, "conflict");
  assert.equal(registry.resolve("imdb:tt0816692")?.ids.tmdb, "157336");
  assert.equal(registry.resolve("tmdb:999"), undefined);
});

test("rejects a type conflict for an established alias", () => {
  const registry = new CanonicalIdentityIndex(keys("work_anime"));
  registry.resolveOrCreate("anime", { imdb: "tt0245429" });

  const result = registry.resolveOrCreate("movie", { imdb: "tt0245429" });

  assert.equal(result.status, "conflict");
  assert.equal(registry.resolve("imdb:tt0245429")?.type, "anime");
});

test("normalizes and resolves legacy namespaced aliases", () => {
  const registry = new CanonicalIdentityIndex(keys("work_anime"));
  const created = registry.resolveOrCreate("anime", { aniList: "00154587", myAnimeList: 52991 });
  assert.equal(created.status, "created");

  assert.deepEqual(parseIdentityAlias("aniList:00154587"), {
    namespace: "aniList",
    value: "154587",
  });
  assert.equal(registry.resolve("aniList:00154587")?.workKey, "work_anime");
  assert.equal(registry.resolve("myAnimeList:52991")?.workKey, "work_anime");
  assert.equal(parseIdentityAlias("provider-native:42"), undefined);
  assert.throws(
    () => formatIdentityAlias({ namespace: "imdb", value: "provider-native-id" }),
    /Invalid imdb identity alias/,
  );
});

test("requires at least one valid external alias", () => {
  const registry = new CanonicalIdentityIndex(keys("unused"));
  assert.throws(
    () => registry.resolveOrCreate("series", { imdb: "bad", providerId: "42" }),
    /needs an external ID/,
  );
});

test("creates an opaque work key instead of reusing an external alias", () => {
  const key = createWorkKey();
  assert.match(key, /^work_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(key, "imdb:tt0816692");
});
