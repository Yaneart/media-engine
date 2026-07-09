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

const engine = new MediaEngine({
  debug: true,
  timeoutMs: 5_000,
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent: "MediaEngineSearchQualitySmoke/0.1.0",
    }),
    wikidataProvider(),
  ],
});

const cases = [
  qualityCase("one -> One Piece", { title: "one", limit: 10 }, ["One Piece", "Ван-Пис"], {
    top: 3,
    minSources: 2,
    requireRating: true,
  }),
  qualityCase("game -> Game of Thrones", { title: "game", limit: 20 }, [
    "Game of Thrones",
    "Игра престолов",
  ]),
  qualityCase("avatar -> Avatar", { title: "avatar", limit: 10 }, [
    "Avatar",
    "Аватар: Легенда об Аанге",
  ]),
  qualityCase("dark -> Dark", { title: "dark", limit: 10 }, ["Dark"], {
    top: 5,
  }),
  qualityCase("breaking bad", { title: "breaking bad", type: "series", limit: 10 }, [
    "Breaking Bad",
    "Во все тяжкие",
  ]),
].slice(0, limit);

const results = [];

for (const testCase of cases) {
  results.push(await runQualityCase(testCase));
}

printSummary(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function qualityCase(name, query, expectedTitles, options = {}) {
  return {
    name,
    query,
    expectedTitles,
    top: options.top ?? 10,
    minSources: options.minSources ?? 1,
    requireRating: options.requireRating ?? false,
    requirePoster: options.requirePoster ?? false,
  };
}

async function runQualityCase(testCase) {
  try {
    const response = await engine.search(testCase.query);
    const matchIndex = response.results.findIndex((result) =>
      testCase.expectedTitles.some((expectedTitle) => hasTitleMatch(result.item, expectedTitle)),
    );
    const matched = matchIndex === -1 ? undefined : response.results[matchIndex];
    const rank = matchIndex === -1 ? undefined : matchIndex + 1;
    const sourceCount = matched ? matched.sources.length : 0;
    const hasRating = Boolean(matched?.item.ratings?.length);
    const hasPoster = Boolean(matched?.item.poster?.url);
    const notes = [
      rank === undefined ? `missing expected: ${testCase.expectedTitles.join(" / ")}` : undefined,
      rank !== undefined && rank > testCase.top
        ? `rank ${rank} below top ${testCase.top}`
        : undefined,
      sourceCount < testCase.minSources
        ? `sources ${sourceCount} below ${testCase.minSources}`
        : undefined,
      testCase.requireRating && !hasRating ? "missing rating" : undefined,
      testCase.requirePoster && !hasPoster ? "missing poster" : undefined,
      response.meta.providers.failed.length
        ? `failed providers: ${response.meta.providers.failed
            .map((failure) => failure.provider)
            .join(", ")}`
        : undefined,
    ].filter(Boolean);
    const status = rank === undefined ? "FAIL" : notes.length > 0 ? "WARN" : "PASS";

    return {
      status,
      name: testCase.name,
      tookMs: response.meta.tookMs,
      rank,
      matched: matched ? formatResult(matched) : "missing",
      topResults: response.results
        .slice(0, 3)
        .map((result) => `${result.item.title} [${result.item.type}]`)
        .join(" | "),
      notes,
    };
  } catch (error) {
    return {
      status: "FAIL",
      name: testCase.name,
      tookMs: 0,
      rank: undefined,
      matched: "error",
      topResults: "",
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function formatResult(result) {
  return `${result.item.title} [${result.item.type}] sources=${result.sources
    .map((source) => source.provider)
    .join(",")} ids=${Object.keys(result.item.ids ?? {}).join(",") || "none"} ratings=${
    result.item.ratings?.map((rating) => rating.source).join(",") || "none"
  } poster=${result.item.poster?.url ? "yes" : "no"}`;
}

function hasTitleMatch(item, expectedTitle) {
  const expected = normalize(expectedTitle);
  const titles = [item.title, item.originalTitle, ...(item.alternativeTitles ?? [])]
    .filter(Boolean)
    .map(normalize);

  return titles.some((title) => title === expected || title.startsWith(`${expected}:`));
}

function normalize(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function printSummary(results) {
  for (const result of results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> rank=${result.rank ?? "n/a"} ${result.matched} [${result.tookMs}ms]${notes}`,
    );
    console.log(`     top: ${result.topResults || "none"}`);
  }

  const pass = results.filter((result) => result.status === "PASS").length;
  const warn = results.filter((result) => result.status === "WARN").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Search quality smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);

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
