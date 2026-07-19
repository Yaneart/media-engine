import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { ProviderError } from "../errors/index.js";
import type { MediaAvailability, StreamQuery } from "../streaming/index.js";
import { MediaEngine } from "./engine.js";
import { createAvailability, createStreamingProvider } from "./test-helpers.js";

test("getAvailability counts a null provider result as a successful no-result", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "empty-stream",
        async getAvailability(): Promise<null> {
          return null;
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(availability.options, []);
  assert.deepEqual(availability.meta?.providers, {
    requested: ["empty-stream"],
    successful: ["empty-stream"],
    failed: [],
  });
});

test("getAvailability keeps a null success when another provider fails retryably", async () => {
  const engine = new MediaEngine({
    streamingProviders: [
      createStreamingProvider({
        name: "empty-stream",
        async getAvailability(): Promise<null> {
          return null;
        },
      }),
      createStreamingProvider({
        name: "failing-stream",
        async getAvailability(): Promise<MediaAvailability> {
          throw new ProviderError({
            provider: "failing-stream",
            code: "PROVIDER_UNAVAILABLE",
            retryable: true,
            message: "Streaming provider is unavailable.",
          });
        },
      }),
    ],
  });

  const availability = await engine.getAvailability({ type: "anime", title: "Naruto" });

  assert.deepEqual(availability.options, []);
  assert.deepEqual(availability.meta?.providers.successful, ["empty-stream"]);
  assert.equal(availability.meta?.providers.failed[0]?.provider, "failing-stream");
  assert.equal(availability.meta?.providers.failed[0]?.retryable, true);
});

test("getAvailability retries a null plus transient failure before caching recovery", async () => {
  let emptyCalls = 0;
  let recoveringCalls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    streamingProviders: [
      createStreamingProvider({
        name: "empty-stream",
        async getAvailability(): Promise<null> {
          emptyCalls += 1;
          return null;
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
              message: "Player lookup timed out.",
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

  assert.deepEqual(first.options, []);
  assert.equal(first.meta?.cached, false);
  assert.equal(second.options.length, 1);
  assert.equal(second.meta?.cached, false);
  assert.equal(third.meta?.cached, true);
  assert.equal(emptyCalls, 2);
  assert.equal(recoveringCalls, 2);
});

test("getAvailability warns and retries options with unknown validation state", async () => {
  let calls = 0;
  const engine = new MediaEngine({
    cache: new MemoryCache(),
    streamingProviders: [
      createStreamingProvider({
        name: "validating-stream",
        async getAvailability(query): Promise<MediaAvailability> {
          calls += 1;
          const availability = createAvailability(query, "validating-stream");
          const validationState = calls === 1 ? "unknown" : "available";

          availability.options[0]!.availability = validationState;
          availability.episodes![0]!.options[0]!.availability = validationState;
          return availability;
        },
      }),
    ],
  });
  const query: StreamQuery = { type: "anime", title: "Naruto" };

  const first = await engine.getAvailability(query);
  const second = await engine.getAvailability(query);
  const third = await engine.getAvailability(query);

  assert.equal(first.options[0]?.availability, "unknown");
  assert.deepEqual(first.meta?.warnings, [
    {
      code: "STREAM_VALIDATION_DEGRADED",
      message: "One or more discovered player options could not be validated reliably.",
    },
  ]);
  assert.equal(first.meta?.cached, false);
  assert.equal(second.options[0]?.availability, "available");
  assert.equal(second.meta?.cached, false);
  assert.equal(third.meta?.cached, true);
  assert.equal(calls, 2);
});
