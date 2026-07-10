#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import { kinobdStreamingProvider } from "../packages/providers/dist/index.js";

const strict = process.argv.includes("--strict");
const limit = readLimit();
const category = readCategory();
let latestAudit;

const engine = new MediaEngine({
  timeoutMs: 20_000,
  streamingProviders: [
    kinobdStreamingProvider({
      userAgent: "MediaEngineSourceFilterAudit/0.1.0",
      onPlayerAudit(audit) {
        latestAudit = audit;
      },
    }),
  ],
});

const cases = [
  kinopoiskCase("movie: Interstellar", "movie", "258687"),
  kinopoiskCase("movie: Inception", "movie", "447301"),
  kinopoiskCase("movie: The Matrix", "movie", "301"),
  kinopoiskCase("movie: Fight Club", "movie", "361"),
  kinopoiskCase("movie: The Shawshank Redemption", "movie", "326"),
  kinopoiskCase("movie: The Green Mile", "movie", "435"),
  kinopoiskCase("movie: Pulp Fiction", "movie", "342"),
  kinopoiskCase("movie: Forrest Gump", "movie", "448"),
  kinopoiskCase("movie: The Lord of the Rings: The Fellowship of the Ring", "movie", "328"),
  kinopoiskCase("movie: Avatar", "movie", "251733"),
  kinopoiskCase("series: Game of Thrones", "series", "464963"),
  kinopoiskCase("series: Breaking Bad", "series", "404900"),
  kinopoiskCase("series: Sherlock", "series", "502838"),
  kinopoiskCase("series: Chernobyl", "series", "1227803"),
  kinopoiskCase("series: Stranger Things", "series", "915196"),
  kinopoiskCase("series: House of the Dragon", "series", "1316601"),
  kinopoiskCase("series: True Detective", "series", "681831"),
  kinopoiskCase("series: Peaky Blinders", "series", "716587"),
  kinopoiskCase("series: Better Call Saul", "series", "796660"),
  kinopoiskCase("series: The Last of Us", "series", "839458"),
  kinopoiskCase("anime: One Piece", "anime", "382731"),
]
  .filter((testCase) => category === undefined || testCase.query.type === category)
  .slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runAuditCase(testCase));
}

printResults(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function kinopoiskCase(name, type, kinopoiskId) {
  return {
    name,
    query: { type, ids: { kinopoisk: kinopoiskId } },
    expectedKinopoiskId: kinopoiskId,
    expectedTitle: name.slice(name.indexOf(":") + 1).trim(),
  };
}

async function runAuditCase(testCase) {
  latestAudit = undefined;
  const startedAt = Date.now();

  try {
    const availability = await engine.getAvailability(testCase.query);
    const audit = latestAudit;
    const invalidFilteredEntries =
      audit?.filtered.filter((entry) => !entry.player || !entry.reason) ?? [];
    const actualKinopoiskId = availability.item?.ids?.kinopoisk;
    const identityMismatch = actualKinopoiskId !== testCase.expectedKinopoiskId;
    const titleMismatch = !matchesExpectedTitle(availability.item, testCase.expectedTitle);
    const status =
      availability.options.length > 0 &&
      audit &&
      invalidFilteredEntries.length === 0 &&
      !identityMismatch &&
      !titleMismatch
        ? "PASS"
        : "FAIL";

    return {
      status,
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      optionCount: availability.options.length,
      identity: `${availability.item?.title ?? "unknown"} kp=${actualKinopoiskId ?? "none"}`,
      audit,
      notes: [
        availability.options.length === 0 ? "no shown player options" : undefined,
        !audit ? "provider audit was not emitted" : undefined,
        invalidFilteredEntries.length > 0 ? "filtered entries missing reasons" : undefined,
        identityMismatch ? `expected kinopoisk=${testCase.expectedKinopoiskId}` : undefined,
        titleMismatch ? `expected title=${testCase.expectedTitle}` : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      optionCount: 0,
      identity: "no item",
      audit: undefined,
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function printResults(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> ${result.identity} options=${result.optionCount} [${result.tookMs}ms]${notes}`,
    );
    console.log(`     discovered: ${formatList(result.audit?.discovered)}`);
    console.log(`     shown:      ${formatList(result.audit?.shown)}`);
    console.log(`     filtered:   ${formatFiltered(result.audit?.filtered)}`);
  }

  const pass = results.filter((result) => result.status === "PASS").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Source filter audit summary: ${pass} PASS, ${fail} FAIL`);
}

function formatList(values) {
  return values?.length ? values.join(", ") : "none";
}

function formatFiltered(entries) {
  return entries?.length
    ? entries.map((entry) => `${entry.player}:${entry.reason}`).join(", ")
    : "none";
}

function matchesExpectedTitle(item, expectedTitle) {
  const normalizedExpectedTitle = normalizeTitle(expectedTitle);

  return [item?.title, item?.originalTitle].some(
    (title) => title && normalizeTitle(title) === normalizedExpectedTitle,
  );
}

function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function readLimit() {
  const index = process.argv.indexOf("--limit");

  if (index === -1) {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function readCategory() {
  const index = process.argv.indexOf("--category");

  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];

  if (value !== "movie" && value !== "series" && value !== "anime") {
    throw new TypeError("--category must be movie, series, or anime.");
  }

  return value;
}
