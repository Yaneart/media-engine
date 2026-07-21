#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import { kinobdStreamingProvider } from "../packages/providers/dist/index.js";
import {
  SMOKE_CLASSIFICATION,
  applySmokeExitCode,
  classifySmokeError,
  createSmokeReport,
  formatSmokePolicy,
  readSmokePolicy,
} from "./smoke-policy.mjs";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const policy = readSmokePolicy();
const limit = readLimit();

const engine = new MediaEngine({
  timeoutMs: 20_000,
  streamingProviders: [
    kinobdStreamingProvider({
      userAgent: createSmokeUserAgent("AvailabilitySmoke"),
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
    { expectEpisodeGroup: true, expectedIds: { kinopoisk: "464963" } },
  ),
  availabilityCase(
    "series title fallback: Game of Thrones S01E01",
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 1,
    },
    3,
    { expectEpisodeGroup: true, expectedIds: { kinopoisk: "464963" } },
  ),
  availabilityCase(
    "anime: Naruto episode 1",
    {
      type: "anime",
      ids: { shikimori: "20" },
      absoluteEpisodeNumber: 1,
    },
    3,
    { expectEpisodeGroup: true, expectedIds: { kinopoisk: "283290" } },
  ),
  availabilityCase(
    "anime broken-player filter: One Piece",
    {
      type: "anime",
      ids: { kinopoisk: "382731" },
    },
    3,
    {
      expectedIds: { kinopoisk: "382731" },
      forbiddenPlayers: ["ASHDI", "HDVB"],
    },
  ),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runAvailabilityCase(testCase));
}

const report = createSmokeReport({ smoke: "availability", policy, results });

printReport(report);
applySmokeExitCode(report);

function availabilityCase(name, query, minOptions, options = {}) {
  return {
    kind: "availability",
    name,
    query,
    minOptions,
    expectEpisodeGroup: options.expectEpisodeGroup ?? false,
    expectedIds: options.expectedIds ?? {},
    forbiddenPlayers: options.forbiddenPlayers ?? [],
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
    const mismatchedIds = Object.entries(testCase.expectedIds).filter(
      ([source, value]) => response.item?.ids?.[source] !== value,
    );
    const forbiddenPlayers = usableOptions
      .map((option) => option.player.label)
      .filter((label) => testCase.forbiddenPlayers.includes(label));
    const contractRegression =
      invalidKinds.length > 0 ||
      missingEpisodeGroup ||
      mismatchedIds.length > 0 ||
      forbiddenPlayers.length > 0;
    const upstreamDegraded = usableOptions.length < testCase.minOptions || failedProviders;
    const status = contractRegression ? "FAIL" : upstreamDegraded ? "WARN" : "PASS";

    return {
      status,
      classification: contractRegression
        ? SMOKE_CLASSIFICATION.contractRegression
        : upstreamDegraded
          ? SMOKE_CLASSIFICATION.upstreamDegraded
          : SMOKE_CLASSIFICATION.healthy,
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
        mismatchedIds.length > 0
          ? `expected item ids: ${mismatchedIds
              .map(([source, value]) => `${source}=${value}`)
              .join(", ")}`
          : undefined,
        forbiddenPlayers.length > 0
          ? `forbidden players returned: ${[...new Set(forbiddenPlayers)].join(", ")}`
          : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    const failure = classifySmokeError(error);

    return {
      ...failure,
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

function printReport(report) {
  if (policy.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const result of report.results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.kind.padEnd(12)} ${result.name} -> ${result.actual}${notes} [${result.tookMs}ms]`,
    );
  }

  const { pass, warn, fail } = report.summary;

  console.log("");
  console.log(`Availability smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
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
