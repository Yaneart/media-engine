import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cache } from "./types.js";
import { MemoryCache } from "./memory.js";

test("returns stored values", () => {
  const cache = new MemoryCache();

  cache.set("movie", { title: "Interstellar" });

  assert.deepEqual(cache.get("movie"), { title: "Interstellar" });
});

test("does not return expired entries", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now });

  cache.set("movie", "Interstellar", { ttlMs: 100 });
  now = 1_101;

  assert.equal(cache.get("movie"), undefined);
  assert.equal(cache.get("movie"), undefined);
});

test("keeps entries before ttl expires", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now });

  cache.set("movie", "Interstellar", { ttlMs: 100 });
  now = 1_099;

  assert.equal(cache.get("movie"), "Interstellar");
});

test("expires zero ttl entries immediately", () => {
  const cache = new MemoryCache({ now: () => 1_000 });

  cache.set("movie", "Interstellar", { ttlMs: 0 });

  assert.equal(cache.get("movie"), undefined);
});

test("delete removes one key", () => {
  const cache = new MemoryCache();

  cache.set("first", 1);
  cache.set("second", 2);
  cache.delete("first");

  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), 2);
});

test("clear removes all keys", () => {
  const cache = new MemoryCache();

  cache.set("first", 1);
  cache.set("second", 2);
  cache.clear();

  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), undefined);
});

test("works through the cache interface in async usage", async () => {
  const cache: Cache = new MemoryCache();

  await cache.set("movie", "Interstellar");

  assert.equal(await cache.get("movie"), "Interstellar");
});

test("applies a default ttl when set does not provide one", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now, defaultTtlMs: 100 });

  cache.set("movie", "Interstellar");
  now = 1_101;

  assert.equal(cache.get("movie"), undefined);
});

test("evicts the least recently used entry when bounded", () => {
  const cache = new MemoryCache({ maxEntries: 2 });

  cache.set("first", 1);
  cache.set("second", 2);
  assert.equal(cache.get("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("third"), 3);
});

test("rejects invalid max entry bounds", () => {
  assert.throws(() => new MemoryCache({ maxEntries: 0 }), /positive integer/);
});
