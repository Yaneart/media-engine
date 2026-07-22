import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { ProviderError } from "../errors/index.js";
import type { TorrentDiscoveryResponse } from "../torrent/index.js";
import { MediaEngine } from "./engine.js";
import { createTorrentProvider, createTorrentResponse, sleep } from "./test-helpers.js";

test("discoverTorrents normalizes queries, selects compatible providers, and merges attribution", async () => {
  const skipped = createTorrentProvider({
    name: "movie-only",
    capabilities: {
      mediaTypes: ["movie"],
      lookup: { byTitle: true, byExternalIds: ["imdb"], byEpisode: false },
    },
  });
  const first = createTorrentProvider({ name: "first" });
  const second = createTorrentProvider({ name: "second" });
  const engine = new MediaEngine({ torrentProviders: [skipped, first, second], debug: true });

  const response = await engine.discoverTorrents({
    type: "series",
    title: "  Dark  ",
    imdb: " TT5753856 ",
    seasonNumber: 1,
    episodeNumber: 2,
    providers: [" second ", "first", "second"],
    language: " EN ",
  });

  assert.deepEqual(response.query, {
    type: "series",
    ids: { imdb: "tt5753856" },
    title: "Dark",
    seasonNumber: 1,
    episodeNumber: 2,
    providers: ["first", "second"],
    language: "en",
  });
  assert.deepEqual(
    response.candidates.map((candidate) => candidate.provider),
    ["first", "second"],
  );
  assert.deepEqual(
    response.sourceProviders.map((source) => source.provider),
    ["first", "second"],
  );
  assert.deepEqual(response.meta?.providers, {
    requested: ["first", "second"],
    successful: ["first", "second"],
    failed: [],
  });
  assert.deepEqual(
    response.meta?.debug?.timings.map(({ provider, status }) => ({ provider, status })),
    [
      { provider: "first", status: "success" },
      { provider: "second", status: "success" },
    ],
  );
});

test("discoverTorrents returns an empty successful response without configured providers", async () => {
  const response = await new MediaEngine().discoverTorrents({
    type: "movie",
    title: "Dune",
  });

  assert.deepEqual(response.candidates, []);
  assert.deepEqual(response.sourceProviders, []);
  assert.deepEqual(response.meta?.providers, { requested: [], successful: [], failed: [] });
  assert.match(response.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("discoverTorrents limit zero avoids provider and cache work", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const provider = createTorrentProvider({
    async discoverTorrents(query) {
      calls += 1;
      return createTorrentResponse(query, "unused");
    },
  });
  const engine = new MediaEngine({ torrentProviders: [provider], cache });

  const response = await engine.discoverTorrents({ type: "movie", title: "Dune", limit: 0 });

  assert.equal(calls, 0);
  assert.deepEqual(response.candidates, []);
  assert.equal(response.meta?.cached, false);
});

test("discoverTorrents limits merged candidates after provider execution", async () => {
  const provider = createTorrentProvider({
    async discoverTorrents(query) {
      const response = createTorrentResponse(query, "catalog");
      response.candidates.push({
        ...response.candidates[0]!,
        id: "catalog:release-2",
        title: "Dune 720p",
      });
      return response;
    },
  });

  const response = await new MediaEngine({ torrentProviders: [provider] }).discoverTorrents({
    type: "movie",
    title: "Dune",
    limit: 1,
  });

  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0]?.id, "catalog:release-1");
});

test("discoverTorrents keeps partial results and normalizes provider failures", async () => {
  const failing = createTorrentProvider({
    name: "failing",
    async discoverTorrents() {
      throw new ProviderError({
        provider: "failing",
        code: "PROVIDER_UNAVAILABLE",
        message: "Tracker unavailable.",
        retryable: true,
      });
    },
  });
  const successful = createTorrentProvider({ name: "successful" });

  const response = await new MediaEngine({
    torrentProviders: [failing, successful],
  }).discoverTorrents({ type: "movie", title: "Dune" });

  assert.deepEqual(
    response.candidates.map((candidate) => candidate.provider),
    ["successful"],
  );
  assert.deepEqual(response.meta?.providers.successful, ["successful"]);
  assert.deepEqual(response.meta?.providers.failed, [
    {
      provider: "failing",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Tracker unavailable.",
    },
  ]);
});

test("discoverTorrents treats a null provider result as a successful empty lookup", async () => {
  const provider = createTorrentProvider({
    name: "empty",
    async discoverTorrents() {
      return null;
    },
  });

  const response = await new MediaEngine({ torrentProviders: [provider] }).discoverTorrents({
    type: "movie",
    title: "Missing",
  });

  assert.deepEqual(response.candidates, []);
  assert.deepEqual(response.meta?.providers.successful, ["empty"]);
  assert.deepEqual(response.meta?.providers.failed, []);
});

test("discoverTorrents throws when every selected provider fails", async () => {
  const provider = createTorrentProvider({
    async discoverTorrents() {
      throw new Error("Broken source");
    },
  });

  await assert.rejects(
    () =>
      new MediaEngine({ torrentProviders: [provider] }).discoverTorrents({
        type: "movie",
        title: "Dune",
      }),
    { name: "MediaEngineError", code: "PROVIDER_ERROR", message: "All torrent providers failed." },
  );
});

test("discoverTorrents caches healthy results and isolates returned objects", async () => {
  let calls = 0;
  const provider = createTorrentProvider({
    async discoverTorrents(query) {
      calls += 1;
      return createTorrentResponse(query, "cached");
    },
  });
  const engine = new MediaEngine({ torrentProviders: [provider], cache: new MemoryCache() });
  const query = { type: "movie", title: "Dune" } as const;

  const first = await engine.discoverTorrents(query);
  first.candidates[0]!.title = "mutated";
  const second = await engine.discoverTorrents(query);

  assert.equal(calls, 1);
  assert.equal(second.candidates[0]?.title, "Dune 1080p");
  assert.equal(second.meta?.cached, true);
});

test("discoverTorrents does not cache retryably degraded partial results", async () => {
  let failures = 0;
  let successes = 0;
  const flaky = createTorrentProvider({
    name: "flaky",
    async discoverTorrents() {
      failures += 1;
      throw new ProviderError({
        provider: "flaky",
        code: "PROVIDER_UNAVAILABLE",
        message: "Temporary outage.",
        retryable: true,
      });
    },
  });
  const healthy = createTorrentProvider({
    name: "healthy",
    async discoverTorrents(query) {
      successes += 1;
      return createTorrentResponse(query, "healthy");
    },
  });
  const engine = new MediaEngine({
    torrentProviders: [flaky, healthy],
    cache: new MemoryCache(),
  });
  const query = { type: "movie", title: "Dune" } as const;

  await engine.discoverTorrents(query);
  await engine.discoverTorrents(query);

  assert.equal(failures, 2);
  assert.equal(successes, 2);
});

test("discoverTorrents coalesces identical work and preserves caller cancellation", async () => {
  let calls = 0;
  const provider = createTorrentProvider({
    async discoverTorrents(query, context): Promise<TorrentDiscoveryResponse> {
      calls += 1;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 30);
        context.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(context.signal?.reason);
          },
          { once: true },
        );
      });
      return createTorrentResponse(query, "shared");
    },
  });
  const engine = new MediaEngine({ torrentProviders: [provider] });
  const controller = new AbortController();
  const query = { type: "movie", title: "Dune" } as const;

  const cancelled = engine.discoverTorrents(query, { signal: controller.signal });
  const active = engine.discoverTorrents(query);
  controller.abort();

  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal((await active).candidates.length, 1);
  assert.equal(calls, 1);
});

test("discoverTorrents enforces provider timeout and records isolated torrent health", async () => {
  const provider = createTorrentProvider({
    name: "slow",
    async discoverTorrents() {
      await sleep(100);
      return null;
    },
  });
  const engine = new MediaEngine({
    torrentProviders: [provider],
    timeoutMs: 5,
    circuitBreaker: { failureThreshold: 1, recoveryTimeoutMs: 60_000 },
  });

  await assert.rejects(() => engine.discoverTorrents({ type: "movie", title: "Dune" }));

  const health = engine.getProviderHealth()[0];
  assert.equal(health?.kind, "torrent");
  assert.equal(health?.circuitState, "open");
  assert.equal(health?.lastFailureCode, "PROVIDER_TIMEOUT");
});

test("torrent provider metadata is cloned and duplicate names are rejected", () => {
  const provider = createTorrentProvider({ name: "catalog", version: "1.0.0", secret: "hidden" });
  const engine = new MediaEngine({ torrentProviders: [provider] });
  const info = engine.getTorrentProviders();

  assert.deepEqual(info, [
    {
      name: "catalog",
      version: "1.0.0",
      kind: "torrent",
      capabilities: provider.capabilities,
    },
  ]);
  assert.equal("secret" in info[0]!, false);
  info[0]!.capabilities.mediaTypes.push("series");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series", "anime"]);

  assert.throws(
    () =>
      new MediaEngine({ torrentProviders: [provider, createTorrentProvider({ name: "catalog" })] }),
    /already registered/,
  );
  assert.throws(
    () => new MediaEngine({ torrentProviders: [createTorrentProvider({ name: " padded " })] }),
    /leading or trailing whitespace/,
  );
  assert.throws(
    () => new MediaEngine({ torrentProviders: [createTorrentProvider({ name: "" })] }),
    /name is required/,
  );
});

test("discoverTorrents rejects malformed and unidentifiable queries", async () => {
  const engine = new MediaEngine();

  await assert.rejects(
    () => engine.discoverTorrents({ type: "movie", title: "Dune", limit: 101 }),
    { code: "INVALID_QUERY" },
  );
  await assert.rejects(
    () => engine.discoverTorrents({ type: "movie", title: "Dune", seasonNumber: -1 }),
    { code: "INVALID_QUERY" },
  );
  await assert.rejects(() => engine.discoverTorrents({ type: "movie" }), { code: "INVALID_QUERY" });
});
