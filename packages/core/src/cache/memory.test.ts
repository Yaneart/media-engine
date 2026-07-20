import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cache } from "./types.js";
import { MemoryCache } from "./memory.js";

test("returns stored values", () => {
  const cache = new MemoryCache();

  cache.set("movie", { title: "Interstellar" });

  assert.deepEqual(cache.get("movie"), { title: "Interstellar" });
});

test("isolates stored values from caller mutations", () => {
  const cache = new MemoryCache();
  const original = { details: { title: "Interstellar" } };

  cache.set("movie", original);
  original.details.title = "Changed before read";
  const first = cache.get<typeof original>("movie")!;
  first.details.title = "Changed after read";

  assert.deepEqual(cache.get("movie"), { details: { title: "Interstellar" } });
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

test("returns expired entries only inside the configured stale window", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now, defaultStaleTtlMs: 500 });

  cache.set("movie", "Interstellar", { ttlMs: 100 });
  assert.equal(cache.getStale("movie"), undefined);

  now = 1_101;
  assert.equal(cache.get("movie"), undefined);
  assert.equal(cache.getStale("movie"), "Interstellar");

  now = 1_600;
  assert.equal(cache.getStale("movie"), undefined);
});

test("isolates stale values and supports disabling stale per entry", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now, defaultStaleTtlMs: 500 });

  cache.set("stale", { title: "Interstellar" }, { ttlMs: 100 });
  cache.set("fresh-only", "Dune", { ttlMs: 100, staleTtlMs: 0 });
  now = 1_101;

  const stale = cache.getStale<{ title: string }>("stale")!;
  stale.title = "Changed";
  assert.equal(cache.getStale<{ title: string }>("stale")?.title, "Interstellar");
  assert.equal(cache.getStale("fresh-only"), undefined);
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

test("rejects invalid default TTL values instead of creating accidental no-expiry entries", () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    -1,
  ]) {
    assert.throws(
      () => new MemoryCache({ defaultTtlMs: value }),
      /defaultTtlMs must be a non-negative safe integer/,
    );
    assert.throws(
      () => new MemoryCache({ defaultStaleTtlMs: value }),
      /defaultStaleTtlMs must be a non-negative safe integer/,
    );
  }
});

test("rejects invalid per-entry TTL values", () => {
  const cache = new MemoryCache();

  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    -1,
  ]) {
    assert.throws(
      () => cache.set("movie", "Interstellar", { ttlMs: value }),
      /ttlMs must be a non-negative safe integer/,
    );
    assert.throws(
      () => cache.set("movie", "Interstellar", { staleTtlMs: value }),
      /staleTtlMs must be a non-negative safe integer/,
    );
  }
});

test("uses omitted default and per-entry TTL as the only no-expiry mode", () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now });

  cache.set("movie", "Interstellar");
  now = Number.MAX_SAFE_INTEGER;

  assert.equal(cache.get("movie"), "Interstellar");
});
