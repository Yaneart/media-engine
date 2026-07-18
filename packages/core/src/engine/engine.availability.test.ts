import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cache, CacheSetOptions } from "../cache/index.js";
import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { MediaAvailability, StreamQuery } from "../streaming/index.js";
import { MediaEngine } from "./engine.js";
import { createAvailability, createStreamingProvider, sleep } from "./test-helpers.js";

test("getAvailability rejects empty identity predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.getAvailability({ type: "anime" }), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Stream query must include title or external ids.",
  });
});

test("getAvailability normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability | null> {
          receivedIds = query.ids;
          return createAvailability(query, "shortcut-provider");
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    shikimori: "20",
    absoluteEpisodeNumber: 1,
  });

  assert.deepEqual(receivedIds, { shikimori: "20" });
  assert.deepEqual(availability.query.ids, { shikimori: "20" });
  assert.equal(availability.options.length, 1);
});

test("getAvailability returns empty availability when no streaming providers are available", async () => {
  const engine = new MediaEngine();
  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(availability.query, { type: "anime", title: "Naruto" });
  assert.deepEqual(availability.options, []);
  assert.deepEqual(availability.sourceProviders, []);
  assert.deepEqual(availability.meta?.providers, {
    requested: [],
    successful: [],
    failed: [],
  });
  assert.equal(typeof availability.checkedAt, "string");
});

test("getAvailability merges multiple streaming provider results", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({ name: "kodik" }),
      createStreamingProvider({ name: "mirror" }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    absoluteEpisodeNumber: 1,
  });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(
    availability.episodes?.[0]?.options.map((option) => option.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(
    availability.sourceProviders.map((source) => source.provider),
    ["kodik", "mirror"],
  );
  assert.deepEqual(availability.meta?.providers.requested, ["kodik", "mirror"]);
  assert.deepEqual(availability.meta?.providers.successful, ["kodik", "mirror"]);
  assert.deepEqual(availability.meta?.providers.failed, []);
});

test("getAvailability derives episode groups from top-level episode options", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "top-level-stream",
        async getAvailability(query): Promise<MediaAvailability | null> {
          const availability = createAvailability(query, "top-level-stream");

          return {
            ...availability,
            episodes: undefined,
          };
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    absoluteEpisodeNumber: 1,
  });

  assert.equal(availability.episodes?.length, 1);
  assert.equal(availability.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.deepEqual(availability.episodes?.[0]?.options, availability.options);
});

test("getAvailability respects requested streaming provider filter", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({ name: "kodik" }),
      createStreamingProvider({ name: "mirror" }),
    ],
  });

  const availability = await engine.getAvailability({
    type: "anime",
    title: "Naruto",
    providers: ["mirror"],
  });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["mirror"],
  );
});

test("getAvailability tolerates one provider failure when another provider succeeds", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new ProviderError({
            provider: "failing-stream",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Streaming provider is unavailable.",
          });
        },
      }),
      createStreamingProvider({ name: "successful-stream" }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["successful-stream"],
  );
  assert.deepEqual(availability.meta?.providers.requested, ["failing-stream", "successful-stream"]);
  assert.deepEqual(availability.meta?.providers.successful, ["successful-stream"]);
  assert.deepEqual(availability.meta?.providers.failed, [
    {
      provider: "failing-stream",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Streaming provider is unavailable.",
    },
  ]);
});

test("getAvailability starts independent streaming providers concurrently", async () => {
  let resolveSlowProvider: ((availability: MediaAvailability) => void) | undefined;
  let markFastProviderStarted: (() => void) | undefined;
  const fastProviderStarted = new Promise<void>((resolve) => {
    markFastProviderStarted = resolve;
  });
  const query: StreamQuery = { type: "anime", title: "Naruto" };
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "slow-stream",
        async getAvailability(): Promise<MediaAvailability> {
          return new Promise((resolve) => {
            resolveSlowProvider = resolve;
          });
        },
      }),
      createStreamingProvider({
        name: "fast-stream",
        async getAvailability(): Promise<MediaAvailability> {
          markFastProviderStarted?.();
          return createAvailability(query, "fast-stream");
        },
      }),
    ],
  });

  const availabilityPromise = engine.getAvailability(query);
  const fastStartedBeforeSlowFinished = await Promise.race([
    fastProviderStarted.then(() => true),
    sleep(20).then(() => false),
  ]);

  resolveSlowProvider?.(createAvailability(query, "slow-stream"));
  const availability = await availabilityPromise;

  assert.equal(fastStartedBeforeSlowFinished, true);
  assert.deepEqual(
    availability.options.map((option) => option.provider),
    ["slow-stream", "fast-stream"],
  );
});

test("getAvailability coalesces concurrent identical requests", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability> {
          calls += 1;
          await sleep(10);
          return createAvailability(query, "test-streaming-provider");
        },
      }),
    ],
  });
  const query: StreamQuery = {
    type: "anime",
    title: "Naruto",
    absoluteEpisodeNumber: 1,
  };

  const [first, second] = await Promise.all([
    engine.getAvailability(query),
    engine.getAvailability(query),
  ]);

  assert.equal(calls, 1);
  assert.notEqual(first, second);
  first.options[0]!.player.label = "Changed";
  assert.equal(second.options[0]?.player.label, "Embedded Player");
});

test("getAvailability includes provider timings when debug is enabled", async () => {
  const engine = new MediaEngine({
    debug: true,
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new Error("Availability failed.");
        },
      }),
      createStreamingProvider({ name: "successful-stream" }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(
    availability.meta?.debug?.timings.map((timing) => ({
      provider: timing.provider,
      status: timing.status,
      tookMsType: typeof timing.tookMs,
    })),
    [
      {
        provider: "failing-stream",
        status: "failed",
        tookMsType: "number",
      },
      {
        provider: "successful-stream",
        status: "success",
        tookMsType: "number",
      },
    ],
  );
});

test("getAvailability throws predictably when all selected streaming providers fail", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new Error("Streaming failed.");
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getAvailability({ type: "anime", title: "Naruto" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.equal((error as MediaEngineError).message, "All streaming providers failed.");
      assert.deepEqual((error as Error & { cause?: unknown }).cause, {
        failed: [
          {
            provider: "failing-stream",
            code: "PROVIDER_ERROR",
            retryable: false,
            message: "Streaming failed.",
          },
        ],
      });
      return true;
    },
  );
});

test("getAvailability applies timeout to streaming providers that do not finish", async () => {
  const engine = new MediaEngine({
    timeoutMs: 1,
    streamingProviders: [
      createStreamingProvider({
        name: "slow-stream",
        async getAvailability(): Promise<MediaAvailability | null> {
          await new Promise(() => undefined);
          return null;
        },
      }),
    ],
  });

  await assert.rejects(
    () => engine.getAvailability({ type: "anime", title: "Naruto" }),
    (error: unknown) => {
      assert.equal(error instanceof MediaEngineError, true);
      assert.equal((error as MediaEngineError).code, "PROVIDER_ERROR");
      assert.deepEqual((error as Error & { cause?: { failed: unknown[] } }).cause?.failed, [
        {
          provider: "slow-stream",
          code: "PROVIDER_TIMEOUT",
          retryable: true,
          message: 'Provider "slow-stream" timed out.',
        },
      ]);
      return true;
    },
  );
});

test("getAvailability cache integration keeps response shape", async () => {
  let calls = 0;
  const cache = new MemoryCache();
  const engine = new MediaEngine({
    cache,
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability | null> {
          calls += 1;
          return createAvailability(query, "test-stream");
        },
      }),
    ],
  });

  const first = await engine.getAvailability({ type: "anime", title: "Naruto" });
  const second = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(first).sort(), [
    "checkedAt",
    "episodes",
    "item",
    "meta",
    "options",
    "query",
    "sourceProviders",
  ]);
  assert.deepEqual(Object.keys(second).sort(), [
    "checkedAt",
    "episodes",
    "item",
    "meta",
    "options",
    "query",
    "sourceProviders",
  ]);
  assert.deepEqual(second.options, first.options);
  assert.equal(first.meta?.cached, false);
  assert.equal(second.meta?.cached, true);
});

test("getAvailability does not cache partial results after a retryable provider failure", async () => {
  let stableCalls = 0;
  let recoveringCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    streamingProviders: [
      createStreamingProvider({
        name: "stable-stream",
        async getAvailability(query): Promise<MediaAvailability> {
          stableCalls += 1;
          return createAvailability(query, "stable-stream");
        },
      }),
      createStreamingProvider({
        name: "recovering-stream",
        async getAvailability(query): Promise<MediaAvailability> {
          recoveringCalls += 1;

          if (recoveringCalls === 1) {
            throw new ProviderError({
              provider: "recovering-stream",
              code: "PROVIDER_TIMEOUT",
              retryable: true,
              message: "Streaming provider timed out.",
            });
          }

          return createAvailability(query, "recovering-stream");
        },
      }),
    ],
  });
  const query: StreamQuery = { type: "anime", title: "Naruto" };

  const first = await engine.getAvailability(query);
  const second = await engine.getAvailability(query);
  const third = await engine.getAvailability(query);

  assert.deepEqual(
    first.options.map((option) => option.provider),
    ["stable-stream"],
  );
  assert.equal(first.meta?.cached, false);
  assert.equal(first.meta?.providers.failed[0]?.code, "PROVIDER_TIMEOUT");
  assert.deepEqual(
    second.options.map((option) => option.provider),
    ["stable-stream", "recovering-stream"],
  );
  assert.equal(second.meta?.cached, false);
  assert.equal(third.meta?.cached, true);
  assert.equal(stableCalls, 2);
  assert.equal(recoveringCalls, 2);
});

test("getAvailability does not return stale streaming links", async () => {
  let now = 1_000;
  let available = true;
  const cache = new MemoryCache({
    now: () => now,
    defaultTtlMs: 100,
    defaultStaleTtlMs: 1_000,
  });
  const engine = new MediaEngine({
    cache,
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability> {
          if (!available) {
            throw new ProviderError({
              provider: "test-streaming-provider",
              code: "PROVIDER_UNAVAILABLE",
              retryable: true,
              message: "Streaming provider is unavailable.",
            });
          }

          return createAvailability(query, "test-streaming-provider");
        },
      }),
    ],
  });
  const query: StreamQuery = { type: "anime", title: "Naruto" };

  await engine.getAvailability(query);
  available = false;
  now = 1_101;

  await assert.rejects(engine.getAvailability(query), MediaEngineError);
});

test("getAvailability bounds cache lifetime by the earliest stream expiration", async () => {
  let cacheOptions: CacheSetOptions | undefined;
  const values = new Map<string, unknown>();
  const cache: Cache = {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T, options?: CacheSetOptions): void {
      values.set(key, value);
      cacheOptions = options;
    },
    delete(key: string): void {
      values.delete(key);
    },
    clear(): void {
      values.clear();
    },
  };
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  const engine = new MediaEngine({
    cache,
    streamingProviders: [
      createStreamingProvider({
        async getAvailability(query): Promise<MediaAvailability | null> {
          const availability = createAvailability(query, "expiring-stream");
          availability.options[0]!.expiresAt = expiresAt;
          return availability;
        },
      }),
    ],
  });

  await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.ok(cacheOptions?.ttlMs !== undefined);
  assert.ok(cacheOptions.ttlMs > 0);
  assert.ok(cacheOptions.ttlMs <= 9_000);
  assert.equal(cacheOptions.staleTtlMs, 0);
});
