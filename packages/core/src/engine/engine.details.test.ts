import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { ProviderDetailsResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("getDetails rejects empty queries predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.getDetails({}), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Details query must include id or external ids.",
  });
});

test("getDetails normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async getDetails(query): Promise<ProviderDetailsResult | null> {
          receivedIds = query.ids;
          return {
            provider: "test-provider",
            details: {
              id: "imdb-tt0816692",
              type: "movie",
              title: "Interstellar",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(receivedIds, { imdb: "tt0816692" });
  assert.deepEqual(response.query.ids, { imdb: "tt0816692" });
  assert.equal(response.details?.title, "Interstellar");
});

test("getDetails skips providers without getDetails", async () => {
  const searchOnlyProvider = createProvider({
    name: "search-only-provider",
    getDetails: undefined,
  });
  const detailsProvider = createProvider({
    name: "details-provider",
    async getDetails(): Promise<ProviderDetailsResult | null> {
      return {
        provider: "details-provider",
        details: {
          id: "movie-1",
          type: "movie",
          title: "Interstellar",
        },
      };
    },
  });
  const engine = new MediaEngine({
    providers: [searchOnlyProvider, detailsProvider],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(response.meta.providers.requested, ["details-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["details-provider"]);
  assert.equal(response.details?.title, "Interstellar");
});

test("getDetails tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new ProviderError({
            provider: "failing-provider",
            code: "PROVIDER_RATE_LIMITED",
            retryable: true,
            message: "Rate limited.",
          });
        },
      }),
      createProvider({
        name: "successful-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details?.title, "Interstellar");
  assert.deepEqual(response.meta.providers.requested, ["failing-provider", "successful-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["successful-provider"]);
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "failing-provider",
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      message: "Rate limited.",
    },
  ]);
});

test("getDetails includes provider timings when debug is enabled", async () => {
  const engine = new MediaEngine({
    debug: true,
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new Error("Details failed.");
        },
      }),
      createProvider({
        name: "successful-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return {
            provider: "successful-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.deepEqual(
    response.meta.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "failing-provider",
        status: "failed",
        tookMsType: "number",
      },
      {
        provider: "successful-provider",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("getDetails calls selected providers concurrently", async () => {
  const calls: string[] = [];
  let releaseFirstProvider: (() => void) | undefined;
  const firstProviderGate = new Promise<void>((resolve) => {
    releaseFirstProvider = resolve;
  });

  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "slow-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls.push("slow-start");
          await firstProviderGate;
          calls.push("slow-finish");

          return {
            provider: "slow-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Slow Details",
            },
          };
        },
      }),
      createProvider({
        name: "fast-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls.push("fast-start");
          releaseFirstProvider?.();
          calls.push("fast-finish");

          return {
            provider: "fast-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Fast Details",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details?.title, "Slow Details");
  assert.deepEqual(calls, ["slow-start", "fast-start", "fast-finish", "slow-finish"]);
});

test("getDetails coalesces concurrent identical requests", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async getDetails(): Promise<ProviderDetailsResult> {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            provider: "test-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const [first, second] = await Promise.all([
    engine.getDetails({ imdb: "tt0816692" }),
    engine.getDetails({ imdb: "tt0816692" }),
  ]);

  assert.equal(calls, 1);
  assert.notEqual(first, second);
  first.details!.title = "Changed";
  assert.equal(second.details?.title, "Interstellar");
});

test("getDetails applies provider timeout overrides within the global boundary", async () => {
  let slowTimeoutMs: number | undefined;
  let fastTimeoutMs: number | undefined;
  const engine = new MediaEngine({
    timeoutMs: 100,
    providerTimeouts: {
      "slow-provider": 5,
      "fast-provider": 500,
    },
    providers: [
      createProvider({
        name: "slow-provider",
        async getDetails(_, context): Promise<ProviderDetailsResult | null> {
          slowTimeoutMs = context.timeoutMs;
          await new Promise((resolve) => setTimeout(resolve, 50));

          return null;
        },
      }),
      createProvider({
        name: "fast-provider",
        async getDetails(_, context): Promise<ProviderDetailsResult | null> {
          fastTimeoutMs = context.timeoutMs;

          return {
            provider: "fast-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Fast Details",
            },
          };
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(slowTimeoutMs, 5);
  assert.equal(fastTimeoutMs, 100);
  assert.equal(response.details?.title, "Fast Details");
  assert.deepEqual(response.meta.providers.failed, [
    {
      provider: "slow-provider",
      code: "PROVIDER_TIMEOUT",
      retryable: true,
      message: 'Provider "slow-provider" timed out.',
    },
  ]);
});

test("getDetails throws predictably when all selected providers fail", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "failing-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          throw new Error("Details failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getDetails({ imdb: "tt0816692" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All details providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-provider",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Details failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("getDetails returns null details when providers return no details", async () => {
  const engine = new MediaEngine({
    providers: [
      createProvider({
        name: "empty-provider",
        async getDetails(): Promise<ProviderDetailsResult | null> {
          return null;
        },
      }),
    ],
  });

  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details, null);
  assert.deepEqual(response.meta.providers.requested, ["empty-provider"]);
  assert.deepEqual(response.meta.providers.successful, ["empty-provider"]);
  assert.deepEqual(response.meta.providers.failed, []);
});

test("getDetails cache integration keeps response shape", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async getDetails(): Promise<ProviderDetailsResult | null> {
          calls += 1;
          return {
            provider: "test-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
            },
          };
        },
      }),
    ],
  });

  const first = await engine.getDetails({ imdb: "tt0816692" });
  const second = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(calls, 1);
  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.deepEqual(Object.keys(first).sort(), ["details", "meta", "query"]);
  assert.deepEqual(Object.keys(second).sort(), ["details", "meta", "query"]);
  assert.deepEqual(second.details, first.details);
});

test("getDetails does not cache partial results after a retryable provider failure", async () => {
  let stableCalls = 0;
  let recoveringCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    providers: [
      createProvider({
        name: "stable-provider",
        async getDetails(): Promise<ProviderDetailsResult> {
          stableCalls += 1;

          return {
            provider: "stable-provider",
            details: {
              id: "movie-1",
              type: "movie",
              title: "Interstellar",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
      createProvider({
        name: "recovering-provider",
        async getDetails(): Promise<ProviderDetailsResult> {
          recoveringCalls += 1;

          if (recoveringCalls === 1) {
            throw new ProviderError({
              provider: "recovering-provider",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Provider timed out.",
            });
          }

          return {
            provider: "recovering-provider",
            details: {
              id: "movie-2",
              type: "movie",
              title: "Interstellar",
              description: "Recovered provider description.",
              ids: { imdb: "tt0816692" },
            },
          };
        },
      }),
    ],
  });

  const first = await engine.getDetails({ imdb: "tt0816692" });
  const second = await engine.getDetails({ imdb: "tt0816692" });
  const third = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(first.details?.description, undefined);
  assert.equal(first.meta.cached, false);
  assert.equal(first.meta.providers.failed[0]?.code, "PROVIDER_TIMEOUT");
  assert.equal(second.details?.description, "Recovered provider description.");
  assert.equal(second.meta.cached, false);
  assert.equal(third.meta.cached, true);
  assert.equal(stableCalls, 2);
  assert.equal(recoveringCalls, 2);
});

test("getDetails uses stale cache only for retryable provider failures", async () => {
  let now = 1_000;
  let failure: ProviderError | undefined;
  const cache = new MemoryCache({
    now: () => now,
    defaultTtlMs: 100,
    defaultStaleTtlMs: 1_000,
  });
  const engine = new MediaEngine({
    cache,
    providers: [
      createProvider({
        async getDetails(): Promise<ProviderDetailsResult> {
          if (failure) {
            throw failure;
          }

          return {
            provider: "test-provider",
            details: { id: "movie-1", type: "movie", title: "Interstellar" },
          };
        },
      }),
    ],
  });

  await engine.getDetails({ imdb: "tt0816692" });
  now = 1_101;
  failure = new ProviderError({
    provider: "test-provider",
    code: "PROVIDER_UNAUTHORIZED",
    retryable: false,
    message: "Provider rejected the request.",
  });
  await assert.rejects(engine.getDetails({ imdb: "tt0816692" }), MediaEngineError);

  failure = new ProviderError({
    provider: "test-provider",
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
    message: "Provider is unavailable.",
  });
  const response = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(response.details?.title, "Interstellar");
  assert.equal(response.meta.cached, true);
  assert.equal(response.meta.stale, true);
  assert.equal(response.meta.providers.failed[0]?.code, "PROVIDER_UNAVAILABLE");
});
