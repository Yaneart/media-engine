#!/usr/bin/env node

import { performance } from "node:perf_hooks";

import { DefaultMergeStrategy } from "../packages/core/dist/merge/index.js";

const json = process.argv.includes("--json");
const iterations = readNumber("--iterations", 5);
const count = readNumber("--count", 2_000);
const duplicateProviders = readNumber("--duplicate-providers", 2);
const thresholdMs = readNumber("--threshold-ms", 1_500);

const strategy = new DefaultMergeStrategy();
const providerResults = createProviderResults(count, duplicateProviders);
const runs = [];

for (let index = 0; index < iterations; index += 1) {
  const warnings = [];
  const startedAt = performance.now();
  const results = strategy.mergeSearchResults(providerResults, {
    query: { title: "Synthetic Movie", limit: count },
    warnings,
  });
  const tookMs = performance.now() - startedAt;

  runs.push({
    tookMs,
    resultCount: results.length,
    warningCount: warnings.length,
    first: formatResult(results[0]),
  });
}

const summary = summarize(runs);
const status =
  runs.every((run) => run.resultCount === count) && summary.medianMs <= thresholdMs
    ? "PASS"
    : "WARN";

if (json) {
  console.log(
    JSON.stringify(
      {
        status,
        inputCount: providerResults.length,
        uniqueMediaCount: count,
        duplicateProviders,
        iterations,
        thresholdMs,
        summary,
        runs,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `${status} merge performance -> input=${providerResults.length} unique=${count} duplicateProviders=${duplicateProviders}`,
  );
  console.log(
    `     median=${summary.medianMs.toFixed(2)}ms min=${summary.minMs.toFixed(
      2,
    )}ms max=${summary.maxMs.toFixed(2)}ms avg=${summary.avgMs.toFixed(2)}ms threshold=${thresholdMs}ms`,
  );
  console.log(`     first=${runs[0]?.first ?? "none"} warnings=${runs[0]?.warningCount ?? 0}`);
}

function createProviderResults(uniqueCount, providersPerItem) {
  const providers = ["kinobd", "cinemeta", "shikimori", "wikidata"];
  const results = [];

  for (let index = 0; index < uniqueCount; index += 1) {
    const mediaNumber = index + 1;
    const type = index % 5 === 0 ? "series" : index % 7 === 0 ? "anime" : "movie";
    const year = 1980 + (index % 45);
    const title = `Synthetic Movie ${String(mediaNumber).padStart(5, "0")}`;
    const imdb = `tt${String(1_000_000 + mediaNumber).padStart(7, "0")}`;
    const kinopoisk = String(500_000 + mediaNumber);

    for (let providerIndex = 0; providerIndex < providersPerItem; providerIndex += 1) {
      const provider = providers[providerIndex % providers.length];

      results.push({
        provider,
        confidence: provider === "kinobd" ? 0.95 : 0.85,
        item: {
          id: `${provider}-${mediaNumber}`,
          type,
          title: provider === "shikimori" ? `${title} TV` : title,
          originalTitle: title,
          alternativeTitles: [`Synthetic ${mediaNumber}`, `Movie ${mediaNumber}`],
          year,
          ids: {
            imdb,
            kinopoisk,
          },
          ratings: [
            {
              source: provider === "kinobd" ? "kinopoisk" : "imdb",
              value: 6 + (index % 40) / 10,
              max: 10,
              votes: 1_000 + index,
            },
          ],
          poster: {
            url: `https://example.test/posters/${mediaNumber}.jpg`,
            type: "poster",
            width: 500,
            height: 750,
            source: provider,
          },
        },
      });
    }
  }

  return results;
}

function summarize(runs) {
  const values = runs.map((run) => run.tookMs).sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  const median = values[Math.floor(values.length / 2)] ?? 0;

  return {
    minMs: values[0] ?? 0,
    medianMs: median,
    maxMs: values.at(-1) ?? 0,
    avgMs: values.length ? sum / values.length : 0,
  };
}

function formatResult(result) {
  if (!result) {
    return undefined;
  }

  return `${result.item.title} [${result.item.type}] score=${result.score.toFixed(
    3,
  )} sources=${result.sources.map((source) => source.provider).join(",")}`;
}

function readNumber(name, fallback) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
