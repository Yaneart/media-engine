import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { MediaDetails } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider, sleep } from "./test-helpers.js";

test("search starts independent providers concurrently", async () => {
  let resolveSlowProvider: ((results: ProviderSearchResult[]) => void) | undefined;
  let markFastProviderStarted: (() => void) | undefined;
  const fastProviderStarted = new Promise<void>((resolve) => {
    markFastProviderStarted = resolve;
  });
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "slow-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return new Promise((resolve) => {
            resolveSlowProvider = resolve;
          });
        },
      }),
      createProvider({
        name: "fast-provider",
        async search(): Promise<ProviderSearchResult[]> {
          markFastProviderStarted?.();

          return [
            {
              provider: "fast-provider",
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

  const searchPromise = engine.search({ title: "Interstellar" });
  const fastStartedBeforeSlowFinished = await Promise.race([
    fastProviderStarted.then(() => true),
    sleep(20).then(() => false),
  ]);

  resolveSlowProvider?.([]);

  assert.equal(fastStartedBeforeSlowFinished, true);

  const response = await searchPromise;

  assert.deepEqual(response.meta.providers.successful, ["slow-provider", "fast-provider"]);
  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "slow-provider",
        status: "success",
        tookMsType: "number",
      },
      {
        provider: "fast-provider",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("search coalesces concurrent identical requests", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          await sleep(10);
          return [
            {
              provider: "test-provider",
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

  const [first, second] = await Promise.all([
    engine.search({ title: "Interstellar" }),
    engine.search({ title: "Interstellar" }),
  ]);

  assert.equal(calls, 1);
  assert.notEqual(first, second);
  first.results[0]!.item.title = "Changed";
  assert.equal(second.results[0]?.item.title, "Interstellar");
});

test("search keeps provider result order deterministic after concurrent completion", async () => {
  const receivedProviders: string[] = [];
  const mergeStrategy: MergeStrategy = {
    mergeSearchResults(results): MediaSearchResult[] {
      receivedProviders.push(...results.map((result) => result.provider));

      return results.map((result) => ({
        item: result.item,
        score: result.confidence ?? 0,
        sources: [{ provider: result.provider, id: result.item.id }],
      }));
    },
    mergeDetails(): MediaDetails | null {
      return null;
    },
  };
  const engine = new MediaEngine({
    mergeStrategy,
    providers: [
      createProvider({
        name: "slow-provider",
        async search(): Promise<ProviderSearchResult[]> {
          await sleep(20);

          return [
            {
              provider: "slow-provider",
              item: {
                id: "movie-slow",
                type: "movie",
                title: "Slow Result",
              },
            },
          ];
        },
      }),
      createProvider({
        name: "fast-provider",
        async search(): Promise<ProviderSearchResult[]> {
          return [
            {
              provider: "fast-provider",
              item: {
                id: "movie-fast",
                type: "movie",
                title: "Fast Result",
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.deepEqual(receivedProviders, ["slow-provider", "fast-provider"]);
  assert.deepEqual(
    response.results.map((result) => result.item.title),
    ["Slow Result", "Fast Result"],
  );
});

test("search throws predictably when all selected providers fail", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async search(): Promise<ProviderSearchResult[]> {
          throw new Error("Network failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.search({ title: "Interstellar" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All search providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-provider",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Network failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("search retries transient failures when every selected provider fails together", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "transient-provider",
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;

          if (calls === 1) {
            throw new ProviderError({
              provider: "transient-provider",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Temporary timeout.",
            });
          }

          return [
            {
              provider: "transient-provider",
              item: { id: "one-piece", type: "anime", title: "One Piece" },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "one piece" });

  assert.equal(calls, 2);
  assert.equal(response.results[0]?.item.title, "One Piece");
  assert.deepEqual(response.meta.providers.failed, []);
});

test("search circuit breaker stops calling a repeatedly failing provider", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    circuitBreaker: { failureThreshold: 1, recoveryTimeoutMs: 60_000 },
    providers: [
      createProvider({
        name: "unstable-provider",
        async search(): Promise<ProviderSearchResult[]> {
          calls += 1;
          throw new ProviderError({
            provider: "unstable-provider",
            code: "PROVIDER_TIMEOUT",
            retryable: true,
            message: "Temporary timeout.",
          });
        },
      }),
    ],
  });

  await assert.rejects(() => engine.search({ title: "First title" }), MediaEngineError);
  await assert.rejects(() => engine.search({ title: "Second title" }), MediaEngineError);

  assert.equal(calls, 1);
});
