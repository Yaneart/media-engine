import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateRetryDelayMs, parseRetryAfterMs } from "./retry.js";

test("parseRetryAfterMs accepts delta-seconds and HTTP dates", () => {
  const now = Date.parse("2026-07-16T10:00:00.000Z");

  assert.equal(parseRetryAfterMs("3", now), 3_000);
  assert.equal(parseRetryAfterMs("Thu, 16 Jul 2026 10:00:05 GMT", now), 5_000);
  assert.equal(parseRetryAfterMs("Thu, 16 Jul 2026 09:59:55 GMT", now), 0);
});

test("parseRetryAfterMs rejects malformed and unsafe values", () => {
  assert.equal(parseRetryAfterMs(null), undefined);
  assert.equal(parseRetryAfterMs(""), undefined);
  assert.equal(parseRetryAfterMs("1.5"), undefined);
  assert.equal(parseRetryAfterMs("not-a-date"), undefined);
  assert.equal(parseRetryAfterMs("999999999999999999999"), undefined);
});

test("calculateRetryDelayMs applies exponential backoff and deterministic jitter", () => {
  const common = {
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    jitterRatio: 0.2,
  };

  assert.equal(calculateRetryDelayMs({ ...common, attempt: 0, randomValue: 0 }), 80);
  assert.equal(calculateRetryDelayMs({ ...common, attempt: 1, randomValue: 0.5 }), 200);
  assert.equal(calculateRetryDelayMs({ ...common, attempt: 2, randomValue: 1 }), 480);
});

test("calculateRetryDelayMs honors Retry-After within the configured bound", () => {
  assert.equal(
    calculateRetryDelayMs({
      baseDelayMs: 100,
      attempt: 0,
      maxDelayMs: 2_000,
      jitterRatio: 0,
      randomValue: 0.5,
      retryAfterMs: 1_500,
    }),
    1_500,
  );
  assert.equal(
    calculateRetryDelayMs({
      baseDelayMs: 1_000,
      attempt: 4,
      maxDelayMs: 2_000,
      jitterRatio: 0,
      randomValue: 0.5,
      retryAfterMs: 30_000,
    }),
    2_000,
  );
});
