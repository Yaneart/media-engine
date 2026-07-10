#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import { kinobdStreamingProvider } from "../packages/providers/dist/index.js";

const strict = process.argv.includes("--strict");
const limit = readLimit();
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
  auditCase("movie: Interstellar", { type: "movie", ids: { kinopoisk: "258687" } }),
  auditCase("series: Game of Thrones", { type: "series", ids: { kinopoisk: "464963" } }),
  auditCase("anime: One Piece", { type: "anime", ids: { kinopoisk: "382731" } }),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runAuditCase(testCase));
}

printResults(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function auditCase(name, query) {
  return { name, query };
}

async function runAuditCase(testCase) {
  latestAudit = undefined;
  const startedAt = Date.now();

  try {
    const availability = await engine.getAvailability(testCase.query);
    const audit = latestAudit;
    const invalidFilteredEntries =
      audit?.filtered.filter((entry) => !entry.player || !entry.reason) ?? [];
    const status =
      availability.options.length > 0 && audit && invalidFilteredEntries.length === 0
        ? "PASS"
        : "FAIL";

    return {
      status,
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      optionCount: availability.options.length,
      audit,
      notes: [
        availability.options.length === 0 ? "no shown player options" : undefined,
        !audit ? "provider audit was not emitted" : undefined,
        invalidFilteredEntries.length > 0 ? "filtered entries missing reasons" : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      optionCount: 0,
      audit: undefined,
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function printResults(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} options=${result.optionCount} [${result.tookMs}ms]${notes}`,
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

function readLimit() {
  const index = process.argv.indexOf("--limit");

  if (index === -1) {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}
