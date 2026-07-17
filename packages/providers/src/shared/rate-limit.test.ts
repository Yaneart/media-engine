import assert from "node:assert/strict";
import { test } from "node:test";

import { deferProviderRateLimitFromResponse, ProviderRateLimitGate } from "./rate-limit.js";

test("ProviderRateLimitGate bounds shared cooldowns", async () => {
  const gate = new ProviderRateLimitGate({ maxCooldownMs: 25 });
  const startedAt = Date.now();

  gate.defer(60_000);
  await gate.wait();

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs >= 15, `expected a bounded wait, received ${elapsedMs}ms`);
});

test("ProviderRateLimitGate does not shorten an existing cooldown", async () => {
  const gate = new ProviderRateLimitGate({ maxCooldownMs: 40 });
  const startedAt = Date.now();

  gate.defer(30);
  gate.defer(1);
  await gate.wait();

  assert.ok(Date.now() - startedAt >= 20);
});

test("ProviderRateLimitGate follows cooldown extensions while waiting", async () => {
  const gate = new ProviderRateLimitGate({ maxCooldownMs: 40 });
  const startedAt = Date.now();

  gate.defer(15);
  const waiting = gate.wait();
  setTimeout(() => gate.defer(25), 5);
  await waiting;

  assert.ok(Date.now() - startedAt >= 20);
});

test("ProviderRateLimitGate waiting is abortable", async () => {
  const gate = new ProviderRateLimitGate({ maxCooldownMs: 1_000 });
  const controller = new AbortController();
  const reason = new Error("request stopped");

  gate.defer(1_000);
  const waiting = gate.wait(controller.signal);
  controller.abort(reason);

  await assert.rejects(waiting, reason);
});

test("ProviderRateLimitGate rejects invalid cooldown bounds", () => {
  assert.throws(() => new ProviderRateLimitGate({ maxCooldownMs: -1 }), RangeError);
  assert.throws(() => new ProviderRateLimitGate({ maxCooldownMs: Number.NaN }), RangeError);
});

test("deferProviderRateLimitFromResponse handles 429 and retryable server hints", async () => {
  const gate = new ProviderRateLimitGate({ maxCooldownMs: 20 });
  const startedAt = Date.now();

  deferProviderRateLimitFromResponse(
    gate,
    new Response("busy", { status: 503, headers: { "retry-after": "60" } }),
  );
  await gate.wait();

  assert.ok(Date.now() - startedAt >= 10);
});
