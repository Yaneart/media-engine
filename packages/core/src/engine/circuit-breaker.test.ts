import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "../errors/index.js";
import { ProviderCircuitBreaker } from "./circuit-breaker.js";

const retryableFailure = new ProviderError({
  provider: "unstable",
  code: "PROVIDER_UNAVAILABLE",
  message: "Upstream unavailable.",
  retryable: true,
});

test("ProviderCircuitBreaker opens after consecutive retryable failures", async () => {
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 2 });
  let calls = 0;
  const fail = () =>
    breaker.run("metadata:unstable", "unstable", async () => {
      calls += 1;
      throw retryableFailure;
    });

  await assert.rejects(fail, { code: "PROVIDER_UNAVAILABLE" });
  await assert.rejects(fail, { code: "PROVIDER_UNAVAILABLE" });
  await assert.rejects(fail, /circuit is open/);
  assert.equal(calls, 2);
});

test("ProviderCircuitBreaker closes after one successful recovery probe", async () => {
  let now = 0;
  const breaker = new ProviderCircuitBreaker(
    { failureThreshold: 1, recoveryTimeoutMs: 100 },
    () => now,
  );

  await assert.rejects(() =>
    breaker.run("metadata:unstable", "unstable", async () => {
      throw retryableFailure;
    }),
  );

  now = 100;
  let releaseProbe: (() => void) | undefined;
  const probe = breaker.run(
    "metadata:unstable",
    "unstable",
    () => new Promise<void>((resolve) => (releaseProbe = resolve)),
  );

  await assert.rejects(
    () => breaker.run("metadata:unstable", "unstable", async () => undefined),
    /circuit is open/,
  );
  releaseProbe?.();
  await probe;
  await assert.doesNotReject(() =>
    breaker.run("metadata:unstable", "unstable", async () => undefined),
  );
});

test("ProviderCircuitBreaker reopens when a recovery probe fails", async () => {
  let now = 0;
  const breaker = new ProviderCircuitBreaker(
    { failureThreshold: 1, recoveryTimeoutMs: 50 },
    () => now,
  );
  const fail = () =>
    breaker.run("metadata:unstable", "unstable", async () => {
      throw retryableFailure;
    });

  await assert.rejects(fail);
  now = 50;
  await assert.rejects(fail);
  now = 99;
  await assert.rejects(fail, /circuit is open/);
  now = 100;
  await assert.rejects(fail, retryableFailure);
});

test("ProviderCircuitBreaker isolates keys and ignores non-retryable failures", async () => {
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
  const invalidRequest = new ProviderError({
    provider: "unstable",
    code: "PROVIDER_ERROR",
    message: "Invalid request.",
    retryable: false,
  });

  await assert.rejects(() =>
    breaker.run("metadata:unstable", "unstable", async () => {
      throw retryableFailure;
    }),
  );
  await assert.doesNotReject(() =>
    breaker.run("streaming:unstable", "unstable", async () => undefined),
  );
  await assert.rejects(() =>
    breaker.run("metadata:other", "other", async () => {
      throw invalidRequest;
    }),
  );
  await assert.doesNotReject(() => breaker.run("metadata:other", "other", async () => undefined));
});

test("ProviderCircuitBreaker validates its limits", () => {
  assert.throws(() => new ProviderCircuitBreaker({ failureThreshold: 0 }), /failureThreshold/);
  assert.throws(() => new ProviderCircuitBreaker({ recoveryTimeoutMs: -1 }), /recoveryTimeoutMs/);
});
