#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tvMazeProvider,
  wikidataProvider,
} from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const userAgent = createSmokeUserAgent("DetailsLatencySmoke");

const strict = process.argv.includes("--strict");
const limit = readLimit();
const thresholdMs = readThresholdMs();

const engine = new MediaEngine({
  debug: true,
  timeoutMs: 5_000,
  providerTimeouts: {
    cinemeta: 2_500,
    tvmaze: 2_500,
    wikidata: 2_500,
  },
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
  latencyCase(
    "series: House of the Dragon",
    {
      type: "series",
      imdb: "tt11198330",
      tmdb: "94997",
      kinopoisk: "1316601",
    },
    ["House of the Dragon", "Дом Дракона"],
  ),
  latencyCase(
    "series: Game of Thrones",
    {
      type: "series",
      imdb: "tt0944947",
      kinopoisk: "464963",
    },
    ["Game of Thrones", "Игра престолов"],
  ),
  latencyCase(
    "movie: Interstellar",
    {
      type: "movie",
      imdb: "tt0816692",
      kinopoisk: "258687",
    },
    ["Interstellar", "Интерстеллар"],
  ),
  latencyCase(
    "anime: One Piece",
    {
      type: "anime",
      shikimori: "21",
      kinopoisk: "382731",
    },
    ["One Piece", "Ван-Пис"],
  ),
  latencyCase(
    "anime: Naruto",
    {
      type: "anime",
      shikimori: "20",
      kinopoisk: "283290",
    },
    ["Naruto", "Наруто"],
  ),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runLatencyCase(testCase));
}

printSummary(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function latencyCase(name, query, expectedTitles) {
  return {
    name,
    query,
    expectedTitles,
  };
}

async function runLatencyCase(testCase) {
  try {
    const response = await engine.getDetails(testCase.query);
    const timings = response.meta.debug?.timings ?? [];
    const slowTimings = timings.filter((timing) => timing.tookMs > thresholdMs);
    const failedProviders = response.meta.providers.failed.map(
      (failure) => `${failure.provider}:${failure.code}`,
    );
    const missingFields = response.details ? findMissingFields(response.details) : [];
    const identityMatches = response.details
      ? testCase.expectedTitles.some((title) => hasTitleMatch(response.details, title))
      : false;
    const status =
      !response.details || !identityMatches
        ? "FAIL"
        : response.meta.tookMs > thresholdMs || slowTimings.length > 0
          ? "WARN"
          : "PASS";

    return {
      status,
      name: testCase.name,
      tookMs: response.meta.tookMs,
      details: response.details ? formatDetails(response.details) : "no details",
      timings,
      failedProviders,
      notes: [
        !response.details ? "no merged details" : undefined,
        response.details && !identityMatches
          ? `unexpected identity; expected ${testCase.expectedTitles.join(" / ")}`
          : undefined,
        response.meta.tookMs > thresholdMs ? `total over ${thresholdMs}ms` : undefined,
        slowTimings.length
          ? `slow providers: ${slowTimings
              .map((timing) => `${timing.provider}=${timing.tookMs}ms`)
              .join(", ")}`
          : undefined,
        missingFields.length ? `missing fields: ${missingFields.join(",")}` : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: 0,
      details: "",
      timings: [],
      failedProviders: [],
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function hasTitleMatch(details, expectedTitle) {
  const expected = normalizeTitle(expectedTitle);
  return [details.title, details.originalTitle, ...(details.alternativeTitles ?? [])]
    .filter(Boolean)
    .map(normalizeTitle)
    .some((title) => title === expected);
}

function normalizeTitle(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function formatDetails(details) {
  const ids = Object.keys(details.ids ?? {}).join(",") || "none";
  const ratings = details.ratings?.map((rating) => rating.source).join(",") || "none";
  const sources = details.sourceProviders?.map((source) => source.provider).join(",") || "none";

  return `${details.title} [${details.type}] year=${details.year ?? "n/a"} ids=${ids} ratings=${ratings} sources=${sources}`;
}

function findMissingFields(details) {
  return [
    details.ids && Object.keys(details.ids).length > 0 ? undefined : "ids",
    details.description ? undefined : "description",
    details.poster?.url ? undefined : "poster",
    details.ratings?.length ? undefined : "ratings",
    details.sourceProviders?.length ? undefined : "sourceProviders",
  ].filter(Boolean);
}

function printSummary(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";
    const failures = result.failedProviders.length
      ? ` failures=${result.failedProviders.join(",")}`
      : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> ${result.details || "no result"} [${result.tookMs}ms]${failures}${notes}`,
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
  console.log(`Details latency smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
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
