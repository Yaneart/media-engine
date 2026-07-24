import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { BitsearchQuotaGate } from "./quota.js";

test("BitsearchQuotaGate blocks an exhausted anonymous quota until reset", () => {
  let now = Date.parse("2026-07-24T12:00:00.000Z");
  const gate = new BitsearchQuotaGate({ now: () => now });
  const response = Response.json(
    {},
    {
      headers: {
        "X-RateLimit-Limit": "200",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "2026-07-25T00:00:00.000Z",
      },
    },
  );

  gate.observe(response);
  assert.throws(
    () => gate.assertAvailable("bitsearch-test"),
    (error) =>
      error instanceof ProviderError && error.code === "PROVIDER_RATE_LIMITED" && error.retryable,
  );

  now = Date.parse("2026-07-25T00:00:00.000Z");
  assert.doesNotThrow(() => gate.assertAvailable("bitsearch-test"));
});

test("BitsearchQuotaGate ignores missing and malformed quota headers", () => {
  const gate = new BitsearchQuotaGate();

  for (const response of [
    Response.json({}),
    Response.json(
      {},
      {
        headers: {
          "X-RateLimit-Limit": "200",
          "X-RateLimit-Remaining": "201",
          "X-RateLimit-Reset": "2026-07-25T00:00:00.000Z",
        },
      },
    ),
    Response.json(
      {},
      {
        headers: {
          "X-RateLimit-Limit": "200",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "tomorrow",
        },
      },
    ),
  ]) {
    gate.observe(response);
  }

  assert.doesNotThrow(() => gate.assertAvailable("bitsearch-test"));
});
