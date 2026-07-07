#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import { kinobdStreamingProvider } from "../packages/providers/dist/index.js";

const strict = process.argv.includes("--strict");
const limit = readLimit();

const engine = new MediaEngine({
  timeoutMs: 20_000,
  streamingProviders: [
    kinobdStreamingProvider({
      userAgent: "MediaEngineAvailabilitySmoke/0.1.0",
    }),
  ],
});

const cases = [
  availabilityCase("movie: Interstellar", { type: "movie", ids: { kinopoisk: "258687" } }, 3),
  availabilityCase(
    "series: Game of Thrones S01E01",
    {
      type: "series",
      ids: { kinopoisk: "464963" },
      seasonNumber: 1,
      episodeNumber: 1,
    },
    3,
    { expectEpisodeGroup: true },
  ),
  availabilityCase(
    "anime: Naruto episode 1",
    {
      type: "anime",
      ids: { shikimori: "20" },
      absoluteEpisodeNumber: 1,
    },
    3,
    { expectEpisodeGroup: true },
  ),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runAvailabilityCase(testCase));
}

printSummary(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function availabilityCase(name, query, minOptions, options = {}) {
  return {
    kind: "availability",
    name,
    query,
    minOptions,
    expectEpisodeGroup: options.expectEpisodeGroup ?? false,
  };
}

async function runAvailabilityCase(testCase) {
  const startedAt = Date.now();

  try {
    const response = await engine.getAvailability(testCase.query);
    const usableOptions = response.options.filter((option) => option.access?.url);
    const failedProviders = response.sourceProviders.length === 0 && usableOptions.length === 0;
    const invalidKinds = usableOptions.filter(
      (option) => !isSupportedPlayerKind(option.player.kind),
    );
    const episodeOptionCount = (response.episodes ?? []).reduce(
      (sum, episode) => sum + episode.options.length,
      0,
    );
    const missingEpisodeGroup = testCase.expectEpisodeGroup && episodeOptionCount === 0;
    const status =
      usableOptions.length >= testCase.minOptions &&
      invalidKinds.length === 0 &&
      !missingEpisodeGroup &&
      !failedProviders
        ? "PASS"
        : "FAIL";

    return {
      status,
      kind: testCase.kind,
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      actual: `${response.item?.title ?? "unknown"} options=${usableOptions.length} episodeOptions=${episodeOptionCount} kinds=${listKinds(
        usableOptions,
      )} players=${listPlayers(usableOptions)}`,
      notes: [
        usableOptions.length < testCase.minOptions
          ? `expected at least ${testCase.minOptions} usable options`
          : undefined,
        invalidKinds.length > 0
          ? `invalid player kinds: ${invalidKinds.map((option) => option.player.kind).join(", ")}`
          : undefined,
        missingEpisodeGroup ? "expected episode-grouped options" : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      status: "FAIL",
      kind: testCase.kind,
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      actual: "",
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function listPlayers(options) {
  return [...new Set(options.map((option) => option.player.label))].slice(0, 8).join(", ");
}

function listKinds(options) {
  return [...new Set(options.map((option) => option.player.kind))].sort().join(",");
}

function isSupportedPlayerKind(kind) {
  return kind === "embed" || kind === "external" || kind === "hls" || kind === "mp4";
}

function printSummary(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.kind.padEnd(12)} ${result.name} -> ${result.actual}${notes} [${result.tookMs}ms]`,
    );
  }

  const pass = results.filter((result) => result.status === "PASS").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Availability smoke summary: ${pass} PASS, ${fail} FAIL`);

  if (!strict && fail > 0) {
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
