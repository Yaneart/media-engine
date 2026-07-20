import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { test } from "node:test";

import type { Cache } from "../cache/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("aborting one search caller keeps coalesced provider work alive", async () => {
  const firstController = new AbortController();
  let providerSignal: AbortSignal | undefined;
  let providerStartedResolve: (() => void) | undefined;
  let providerResultResolve: ((results: ProviderSearchResult[]) => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(_, context): Promise<ProviderSearchResult[]> {
          providerSignal = context.signal;
          providerStartedResolve?.();
          return new Promise((resolve) => {
            providerResultResolve = resolve;
          });
        },
      }),
    ],
  });
  const first = engine.search({ title: "Interstellar" }, { signal: firstController.signal });
  const second = engine.search({ title: "Interstellar" });

  await providerStarted;
  const reason = new Error("first caller disconnected");
  firstController.abort(reason);
  await assert.rejects(first, (error) => error === reason);
  assert.equal(providerSignal?.aborted, false);

  providerResultResolve?.([createSearchResult("Interstellar")]);
  const response = await second;
  assert.equal(response.results[0]?.item.title, "Interstellar");
});

test("aborting every search caller cancels provider work and frees its concurrency slot", async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  let calls = 0;
  let providerStartedResolve: (() => void) | undefined;
  let providerAbortedResolve: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const providerAborted = new Promise<void>((resolve) => {
    providerAbortedResolve = resolve;
  });
  const engine = new MediaEngine({
    circuitBreaker: { failureThreshold: 1, recoveryTimeoutMs: 60_000 },
    providerConcurrency: { defaultMaxConcurrent: 1 },
    providers: [
      createProvider({
        name: "cancellable-provider",
        async search(query, context): Promise<ProviderSearchResult[]> {
          calls += 1;

          if (calls > 1) {
            return [createSearchResult(query.title ?? "Recovered")];
          }

          providerStartedResolve?.();
          return new Promise((_, reject) => {
            context.signal?.addEventListener(
              "abort",
              () => {
                providerAbortedResolve?.();
                reject(context.signal?.reason);
              },
              { once: true },
            );
          });
        },
      }),
    ],
  });
  const first = engine.search({ title: "Shared cancellation" }, { signal: firstController.signal });
  const second = engine.search(
    { title: "Shared cancellation" },
    { signal: secondController.signal },
  );

  await providerStarted;
  firstController.abort(new Error("first caller left"));
  secondController.abort(new Error("second caller left"));
  await Promise.all([
    assert.rejects(first, /first caller left/),
    assert.rejects(second, /second caller left/),
    providerAborted,
  ]);

  const health = engine.getProviderHealth()[0];
  assert.equal(health?.circuitState, "closed");
  assert.equal(health?.totalFailures, 0);

  const after = await engine.search({ title: "Shared cancellation" });
  assert.equal(after.results[0]?.item.title, "Shared cancellation");
  assert.equal(calls, 2);
});

test("aborting queued work removes it before provider start", async () => {
  const queuedController = new AbortController();
  let calls = 0;
  let slowStartedResolve: (() => void) | undefined;
  let slowResultResolve: ((results: ProviderSearchResult[]) => void) | undefined;
  const slowStarted = new Promise<void>((resolve) => {
    slowStartedResolve = resolve;
  });
  const engine = new MediaEngine({
    providerConcurrency: { defaultMaxConcurrent: 1 },
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          calls += 1;

          if (query.title === "Slow") {
            slowStartedResolve?.();
            return new Promise((resolve) => {
              slowResultResolve = resolve;
            });
          }

          return [createSearchResult(query.title ?? "Unknown")];
        },
      }),
    ],
  });
  const slow = engine.search({ title: "Slow" });
  await slowStarted;
  const queued = engine.search({ title: "Queued" }, { signal: queuedController.signal });
  await waitForImmediate();
  assert.equal(calls, 1);

  queuedController.abort(new Error("queued caller left"));
  await assert.rejects(queued, /queued caller left/);
  slowResultResolve?.([createSearchResult("Slow")]);
  await slow;
  await waitForImmediate();
  assert.equal(calls, 1);

  const after = await engine.search({ title: "After queue" });
  assert.equal(after.results[0]?.item.title, "After queue");
  assert.equal(calls, 2);
});

test("fully cancelled work does not write a cache entry", async () => {
  const controller = new AbortController();
  let cacheWrites = 0;
  let providerStartedResolve: (() => void) | undefined;
  let providerAbortedResolve: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    providerStartedResolve = resolve;
  });
  const providerAborted = new Promise<void>((resolve) => {
    providerAbortedResolve = resolve;
  });
  const cache: Cache = {
    get: () => undefined,
    set: () => {
      cacheWrites += 1;
    },
    delete: () => undefined,
    clear: () => undefined,
  };
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async search(_, context): Promise<ProviderSearchResult[]> {
          providerStartedResolve?.();
          return new Promise((_, reject) => {
            context.signal?.addEventListener(
              "abort",
              () => {
                providerAbortedResolve?.();
                reject(context.signal?.reason);
              },
              { once: true },
            );
          });
        },
      }),
    ],
  });
  const pending = engine.search({ title: "Do not cache" }, { signal: controller.signal });

  await providerStarted;
  controller.abort(new Error("caller left"));
  await Promise.all([assert.rejects(pending, /caller left/), providerAborted]);
  await waitForImmediate();
  assert.equal(cacheWrites, 0);
});

test("pre-aborted options reject every public operation before providers run", async () => {
  const controller = new AbortController();
  const reason = new Error("already aborted");
  let metadataCalls = 0;
  let streamingCalls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        search: async () => {
          metadataCalls += 1;
          return [];
        },
        getDetails: async () => {
          metadataCalls += 1;
          return null;
        },
      }),
    ],
    streamingProviders: [
      {
        name: "streaming-provider",
        kind: "streaming",
        capabilities: {
          mediaTypes: ["movie"],
          lookup: { byTitle: true, byExternalIds: [], byEpisode: false },
        },
        async getAvailability() {
          streamingCalls += 1;
          return null;
        },
      },
    ],
  });
  controller.abort(reason);

  await assert.rejects(
    engine.search({ title: "Interstellar" }, { signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    engine.getDetails({ imdb: "tt0816692" }, { signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    engine.getAvailability({ type: "movie", title: "Interstellar" }, { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(metadataCalls, 0);
  assert.equal(streamingCalls, 0);
});

function createSearchResult(title: string): ProviderSearchResult {
  return {
    provider: "test-provider",
    item: {
      id: title.toLowerCase().replaceAll(" ", "-"),
      type: "movie",
      title,
    },
  };
}
