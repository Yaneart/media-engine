#!/usr/bin/env node

import { MediaEngine, MemoryCache } from "../packages/core/dist/index.js";
import {
  kinobdStreamingProvider,
  kodikStreamingProvider,
} from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const apiKey = process.env.KODIK_API_KEY?.trim();
if (!apiKey) throw new Error("KODIK_API_KEY is required for the streaming rollout gate.");

const query = {
  type: "movie",
  ids: { kinopoisk: "1043758", imdb: "tt6751668" },
};
const userAgent = createSmokeUserAgent("StreamingRolloutGate");
const direct = kodikStreamingProvider({ apiKey, userAgent });
const aggregate = kinobdStreamingProvider({ userAgent });
const progressiveEngine = new MediaEngine({
  streamingProviders: [direct, aggregate],
  timeoutMs: 12_000,
  providerTimeouts: { "kodik-streaming": 10_000, "kinobd-streaming": 10_000 },
});

const startedAt = Date.now();
let firstUseful;
let finalSnapshot;
for await (const snapshot of progressiveEngine.getAvailabilityProgressively(query)) {
  if (!firstUseful && (snapshot.availability?.options.length ?? 0) > 0) {
    firstUseful = { snapshot, elapsedMs: Date.now() - startedAt };
  }
  finalSnapshot = snapshot;
}
const finalElapsedMs = Date.now() - startedAt;

assert(firstUseful, "No useful progressive streaming snapshot was emitted.");
assert(
  finalElapsedMs - firstUseful.elapsedMs >= 1_000,
  "Direct Kodik did not become observable before the aggregate deadline.",
);
assert(finalSnapshot?.state === "complete", "The rollout did not emit a complete snapshot.");
assert(
  finalSnapshot.availability?.options.some((option) => option.provider === "kodik-streaming"),
  "The final snapshot lost direct Kodik options.",
);
assert(
  finalSnapshot.availability?.meta?.providers.requested.includes("kinobd-streaming"),
  "The aggregate fallback was not independently requested.",
);

let directCalls = 0;
const countedDirect = {
  ...direct,
  async getAvailability(...args) {
    directCalls += 1;
    return direct.getAvailability(...args);
  },
};
const cacheEngine = new MediaEngine({
  streamingProviders: [countedDirect],
  cache: new MemoryCache({ defaultTtlMs: 300_000, defaultStaleTtlMs: 0 }),
  timeoutMs: 10_000,
});
const coldStartedAt = Date.now();
const cold = await cacheEngine.getAvailability(query);
const coldMs = Date.now() - coldStartedAt;
const warmStartedAt = Date.now();
const warm = await cacheEngine.getAvailability(query);
const warmMs = Date.now() - warmStartedAt;
assert(cold.options.length > 0, "Cold direct lookup returned no options.");
assert(warm.options.length === cold.options.length, "Warm cache changed the option count.");
assert(warm.meta?.cached === true, "Warm lookup did not use the availability cache.");
assert(directCalls === 1, "Warm lookup called Kodik again.");
assert(warmMs <= 100, "Warm availability exceeded the 100ms cache budget.");

const directAvailability = await direct.getAvailability(query, { timeoutMs: 10_000 });
const duplicate = directAvailability?.options[0];
assert(directAvailability && duplicate, "Deduplication fixture has no direct option.");
const aggregateDuplicate = {
  name: "aggregate-fixture",
  kind: "streaming",
  capabilities: direct.capabilities,
  async getAvailability(requestQuery) {
    return {
      query: requestQuery,
      options: [
        {
          ...structuredClone(duplicate),
          id: "aggregate-fixture:kodik",
          provider: "aggregate-fixture",
          discovery: "aggregate",
        },
      ],
      sourceProviders: [{ provider: "aggregate-fixture" }],
      checkedAt: new Date().toISOString(),
    };
  },
};
const deduped = await new MediaEngine({
  streamingProviders: [
    aggregateDuplicate,
    {
      ...direct,
      async getAvailability() {
        return directAvailability;
      },
    },
  ],
}).getAvailability(query);
const selected = deduped.options.find((option) => option.access.url === duplicate.access.url);
assert(
  selected?.provider === "kodik-streaming",
  "Equivalent aggregate target replaced direct Kodik.",
);
assert(
  selected.attributions?.some((entry) => entry.provider === "aggregate-fixture") &&
    selected.attributions.some((entry) => entry.provider === "kodik-streaming"),
  "Deduplication lost direct or aggregate attribution.",
);

console.log(
  JSON.stringify(
    {
      gate: "streaming-rollout",
      progressive: {
        firstUsefulMs: firstUseful.elapsedMs,
        finalMs: finalElapsedMs,
        options: finalSnapshot.availability?.options.length ?? 0,
        aggregateFailures: finalSnapshot.availability?.meta?.providers.failed ?? [],
      },
      cache: { coldMs, warmMs, directCalls, options: warm.options.length },
      deduplication: {
        selectedProvider: selected.provider,
        attributions: selected.attributions?.map((entry) => entry.provider) ?? [],
      },
    },
    null,
    2,
  ),
);

function assert(value, message) {
  if (!value) throw new Error(message);
}
