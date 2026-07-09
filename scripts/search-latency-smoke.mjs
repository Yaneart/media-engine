#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  wikidataProvider,
} from "../packages/providers/dist/index.js";

const strict = process.argv.includes("--strict");
const limit = readLimit();
const thresholdMs = readThresholdMs();

const engine = new MediaEngine({
  debug: true,
  timeoutMs: 5_000,
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent: "MediaEngineSearchLatencySmoke/0.1.0",
    }),
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

printSummary(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

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
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: 0,
      topResults: "",
      timings: [],
      failedProviders: [],
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function printSummary(results) {
  for (const result of results) {
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

  const pass = results.filter((result) => result.status === "PASS").length;
  const warn = results.filter((result) => result.status === "WARN").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Search latency smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
  console.log(`Latency threshold: ${thresholdMs}ms`);

  if (!strict && (warn > 0 || fail > 0)) {
    console.log("Run with --strict to make failures exit non-zero.");
  }
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
