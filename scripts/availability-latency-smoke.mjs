#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import { kinobdStreamingProvider } from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const strict = process.argv.includes("--strict");
const limit = readLimit();
const thresholdMs = readThresholdMs();

const engine = new MediaEngine({
  debug: true,
  timeoutMs: 8_000,
  streamingProviders: [
    kinobdStreamingProvider({
      userAgent: createSmokeUserAgent("AvailabilityLatencySmoke"),
    }),
  ],
});

const cases = [
  latencyCase("movie: Interstellar", { type: "movie", ids: { kinopoisk: "258687" } }),
  latencyCase("series: Game of Thrones S01E01", {
    type: "series",
    ids: { kinopoisk: "464963" },
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  latencyCase("series: House of the Dragon", {
    type: "series",
    title: "Дом Дракона",
    year: 2022,
    ids: { imdb: "tt11198330", tmdb: "94997", kinopoisk: "1316601" },
  }),
  latencyCase("series title fallback: Game of Thrones S01E01", {
    type: "series",
    title: "Game of Thrones",
    year: 2011,
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  latencyCase("anime: Naruto episode 1", {
    type: "anime",
    ids: { shikimori: "20" },
    absoluteEpisodeNumber: 1,
  }),
  latencyCase("anime: One Piece", {
    type: "anime",
    ids: { kinopoisk: "382731" },
  }),
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
    const response = await engine.getAvailability(testCase.query);
    const timings = response.meta?.debug?.timings ?? [];
    const usableOptions = response.options.filter((option) => option.access?.url);
    const slowTimings = timings.filter((timing) => timing.tookMs > thresholdMs);
    const failedProviders =
      response.meta?.providers.failed.map((failure) => `${failure.provider}:${failure.code}`) ?? [];
    const status =
      response.meta && (response.meta.tookMs > thresholdMs || slowTimings.length > 0)
        ? "WARN"
        : usableOptions.length > 0
          ? "PASS"
          : "FAIL";

    return {
      status,
      name: testCase.name,
      tookMs: response.meta?.tookMs ?? 0,
      actual: `${response.item?.title ?? "unknown"} options=${usableOptions.length} episodeOptions=${countEpisodeOptions(
        response,
      )} players=${listPlayers(usableOptions)}`,
      timings,
      failedProviders,
      notes: [
        response.meta && response.meta.tookMs > thresholdMs
          ? `total over ${thresholdMs}ms`
          : undefined,
        slowTimings.length
          ? `slow providers: ${slowTimings
              .map((timing) => `${timing.provider}=${timing.tookMs}ms`)
              .join(", ")}`
          : undefined,
        usableOptions.length === 0 ? "no usable player options" : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: 0,
      actual: "",
      timings: [],
      failedProviders: [],
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function countEpisodeOptions(response) {
  return (response.episodes ?? []).reduce((sum, episode) => sum + episode.options.length, 0);
}

function listPlayers(options) {
  return [...new Set(options.map((option) => option.player.label))].slice(0, 8).join(", ");
}

function printSummary(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";
    const failures = result.failedProviders.length
      ? ` failures=${result.failedProviders.join(",")}`
      : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> ${result.actual || "no result"} [${result.tookMs}ms]${failures}${notes}`,
    );

    for (const timing of result.timings) {
      console.log(
        `     ${timing.provider.padEnd(18)} ${timing.status.padEnd(7)} ${String(
          timing.tookMs,
        ).padStart(5)}ms`,
      );
    }
  }

  const pass = results.filter((result) => result.status === "PASS").length;
  const warn = results.filter((result) => result.status === "WARN").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Availability latency smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
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
    return 8_000;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : 8_000;
}
