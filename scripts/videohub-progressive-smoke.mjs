#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { MediaEngine } from "../packages/core/dist/index.js";
import { videoHubStreamingProvider } from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const playbackUserAgent = createSmokeUserAgent("VideoHubProgressiveSmoke");
const engine = new MediaEngine({
  timeoutMs: 20_000,
  streamingProviders: [videoHubStreamingProvider({ userAgent: playbackUserAgent })],
});
const query = {
  type: "anime",
  ids: { kinopoisk: "5401195" },
  absoluteEpisodeNumber: 1,
};

const cold = await measure("cold");
const warm = await measure("warm");

console.log(
  JSON.stringify(
    {
      smoke: "videohub-progressive",
      query,
      cold,
      warm,
    },
    null,
    2,
  ),
);

async function measure(mode) {
  const startedAt = performance.now();
  let firstPlayableMs;
  let snapshots = 0;
  let finalOptions = 0;
  let complete = false;

  for await (const snapshot of engine.getAvailabilityProgressively(query, {
    playbackUserAgent,
  })) {
    snapshots += 1;
    const options = snapshot.availability?.options.length ?? 0;
    if (firstPlayableMs === undefined && options > 0) {
      firstPlayableMs = Math.round(performance.now() - startedAt);
    }
    if (snapshot.state === "complete") {
      complete = true;
      finalOptions = options;
    }
  }

  if (!complete || firstPlayableMs === undefined || finalOptions === 0) {
    throw new Error(`VideoHUB ${mode} progressive smoke returned no complete playable result.`);
  }

  return {
    firstPlayableMs,
    completeMs: Math.round(performance.now() - startedAt),
    snapshots,
    finalOptions,
  };
}
