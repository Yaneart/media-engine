#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tvMazeProvider,
  wikidataProvider,
} from "../packages/providers/dist/index.js";
import {
  SMOKE_CLASSIFICATION,
  applySmokeExitCode,
  classifySmokeError,
  createSmokeReport,
  formatSmokePolicy,
  readSmokePolicy,
} from "./smoke-policy.mjs";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const userAgent = createSmokeUserAgent("SearchLatencySmoke");

const policy = readSmokePolicy();
const limit = readLimit();
const thresholdMs = readThresholdMs();

const engine = new MediaEngine({
  debug: true,
  timeoutMs: 5_000,
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent,
    }),
    tvMazeProvider({ userAgent }),
    wikidataProvider(),
  ],
});

const cases = [
  latencyCase("broad: one", { title: "one", limit: 5 }),
  latencyCase("broad: game", { title: "game", limit: 5 }),
  latencyCase("anime: naruto", { title: "naruto", type: "anime", limit: 5 }),
  latencyCase("movie: interstellar", { title: "interstellar", type: "movie", limit: 5 }),
  latencyCase("series: breaking bad", { title: "breaking bad", type: "series", limit: 5 }),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runLatencyCase(testCase));
}

const report = createSmokeReport({
  smoke: "search-latency",
  policy,
  metadata: { thresholdMs },
  results,
});

printReport(report);
applySmokeExitCode(report);

function latencyCase(name, query) {
  return {
    name,
    query,
  };
}

async function runLatencyCase(testCase) {
  try {
    const response = await engine.search(testCase.query);
    const timings = response.meta.debug?.timings ?? [];
    const slowTimings = timings.filter((timing) => timing.tookMs > thresholdMs);
    const status = response.meta.tookMs > thresholdMs || slowTimings.length > 0 ? "WARN" : "PASS";

    return {
      status,
      classification:
        status === "WARN" ? SMOKE_CLASSIFICATION.budgetExceeded : SMOKE_CLASSIFICATION.healthy,
      name: testCase.name,
      tookMs: response.meta.tookMs,
      topResults: response.results
        .slice(0, 3)
        .map((result) => `${result.item.title} [${result.item.type}]`)
        .join(" | "),
      timings,
      failedProviders: response.meta.providers.failed.map(
        (failure) => `${failure.provider}:${failure.code}`,
      ),
      notes: [
        response.meta.tookMs > thresholdMs ? `total over ${thresholdMs}ms` : undefined,
        slowTimings.length
          ? `slow providers: ${slowTimings
              .map((timing) => `${timing.provider}=${timing.tookMs}ms`)
              .join(", ")}`
          : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    const failure = classifySmokeError(error);

    return {
      ...failure,
      name: testCase.name,
      tookMs: 0,
      topResults: "",
      timings: [],
      failedProviders: [],
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function printReport(report) {
  if (policy.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const result of report.results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";
    const failures = result.failedProviders.length
      ? ` failures=${result.failedProviders.join(",")}`
      : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> ${result.topResults || "no results"} [${result.tookMs}ms]${failures}${notes}`,
    );

    for (const timing of result.timings) {
      console.log(
        `     ${timing.provider.padEnd(12)} ${timing.status.padEnd(7)} ${String(
          timing.tookMs,
        ).padStart(5)}ms`,
      );
    }
  }

  const { pass, warn, fail } = report.summary;

  console.log("");
  console.log(`Search latency smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
  console.log(`Latency threshold: ${thresholdMs}ms`);
  console.log(formatSmokePolicy(report));
}

function readLimit() {
  const index = process.argv.indexOf("--limit");

  if (index === -1) {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function readThresholdMs() {
  const index = process.argv.indexOf("--threshold-ms");

  if (index === -1) {
    return 5_000;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : 5_000;
}
