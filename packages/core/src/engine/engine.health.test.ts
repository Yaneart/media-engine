import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import type { MediaAvailability } from "../streaming/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider, createStreamingProvider } from "./test-helpers.js";

test("getProviderHealth reports isolated metadata and streaming observations", async () => {
  const engine = new MediaEngine({
    circuitBreaker: { failureThreshold: 1, recoveryTimeoutMs: 60_000 },
    providers: [
      createProvider({
        name: "shared-name",
        async search(): Promise<ProviderSearchResult[]> {
          return [];
        },
      }),
    ],
    streamingProviders: [
      createStreamingProvider({
        name: "shared-name",
        async getAvailability(): Promise<MediaAvailability | null> {
          throw new ProviderError({
            provider: "shared-name",
            code: "PROVIDER_UNAVAILABLE",
            message: "Streaming upstream unavailable.",
            retryable: true,
          });
        },
      }),
    ],
  });

  await engine.search({ title: "Dune" });
  await assert.rejects(() => engine.getAvailability({ type: "anime", title: "Dune" }));

  const [metadata, streaming] = engine.getProviderHealth();
  assert.deepEqual(metadata, {
    provider: "shared-name",
    kind: "metadata",
    circuitState: "closed",
    consecutiveFailures: 0,
    totalRequests: 1,
    totalSuccesses: 1,
    totalFailures: 0,
    lastSuccessAt: metadata?.lastSuccessAt,
    lastFailureAt: undefined,
    retryAfterMs: undefined,
  });
  assert.match(metadata?.lastSuccessAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(streaming?.circuitState, "open");
  assert.equal(streaming?.consecutiveFailures, 1);
  assert.equal(streaming?.totalRequests, 1);
  assert.equal(streaming?.totalSuccesses, 0);
  assert.equal(streaming?.totalFailures, 1);
  assert.match(streaming?.lastFailureAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.ok((streaming?.retryAfterMs ?? 0) > 0);
});

test("getProviderHealth marks circuit telemetry as disabled", () => {
  const engine = new MediaEngine({
    providers: [createProvider({ name: "catalog" })],
    circuitBreaker: false,
  });

  assert.deepEqual(engine.getProviderHealth(), [
    {
      provider: "catalog",
      kind: "metadata",
      circuitState: "disabled",
      consecutiveFailures: 0,
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
    },
  ]);
});
