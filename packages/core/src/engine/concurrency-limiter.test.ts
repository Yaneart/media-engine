import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "../errors/index.js";
import { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import { sleep } from "./test-helpers.js";

test("ProviderConcurrencyLimiter bounds work independently per provider key", async () => {
  const limiter = new ProviderConcurrencyLimiter({ defaultMaxConcurrent: 2 });
  const active = new Map<string, number>();
  const maximum = new Map<string, number>();

  const run = (key: string) =>
    limiter.run(key, key, undefined, async () => {
      const current = (active.get(key) ?? 0) + 1;
      active.set(key, current);
      maximum.set(key, Math.max(maximum.get(key) ?? 0, current));
      await sleep(10);
      active.set(key, current - 1);
    });

  await Promise.all([
    run("metadata:one"),
    run("metadata:one"),
    run("metadata:one"),
    run("metadata:two"),
    run("metadata:two"),
    run("metadata:two"),
  ]);

  assert.equal(maximum.get("metadata:one"), 2);
  assert.equal(maximum.get("metadata:two"), 2);
});

test("ProviderConcurrencyLimiter removes an aborted queued call", async () => {
  const limiter = new ProviderConcurrencyLimiter({ defaultMaxConcurrent: 1 });
  let releaseFirst: (() => void) | undefined;
  let queuedCalls = 0;
  const first = limiter.run(
    "metadata:test",
    "test",
    undefined,
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const controller = new AbortController();
  const timeoutError = new ProviderError({
    provider: "test",
    code: "PROVIDER_TIMEOUT",
    message: "Timed out while queued.",
    retryable: true,
  });
  const queued = limiter.run("metadata:test", "test", controller.signal, async () => {
    queuedCalls += 1;
  });

  controller.abort(timeoutError);
  await assert.rejects(queued, (error) => error === timeoutError);
  releaseFirst?.();
  await first;
  await limiter.run("metadata:test", "test", undefined, async () => {
    queuedCalls += 1;
  });

  assert.equal(queuedCalls, 1);
});

test("ProviderConcurrencyLimiter rejects work when its bounded queue is full", async () => {
  const limiter = new ProviderConcurrencyLimiter({
    defaultMaxConcurrent: 1,
    maxQueueSize: 0,
  });
  let releaseFirst: (() => void) | undefined;
  const first = limiter.run(
    "metadata:test",
    "test",
    undefined,
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );

  await assert.rejects(
    limiter.run("metadata:test", "test", undefined, async () => undefined),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_UNAVAILABLE",
  );
  releaseFirst?.();
  await first;
});

test("ProviderConcurrencyLimiter validates limits and provider overrides", () => {
  assert.doesNotThrow(
    () =>
      new ProviderConcurrencyLimiter({
        defaultMaxConcurrent: 3,
        maxQueueSize: 50,
        providerLimits: { kinobd: 1 },
      }),
  );
  assert.throws(
    () => new ProviderConcurrencyLimiter({ defaultMaxConcurrent: 0 }),
    /defaultMaxConcurrent/,
  );
  assert.throws(
    () => new ProviderConcurrencyLimiter({ providerLimits: { " kinobd": 1 } }),
    /override names/,
  );
});
