#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tvMazeProvider,
  wikidataProvider,
} from "../packages/providers/dist/index.js";

const strict = process.argv.includes("--strict");
const limit = readLimit();

const engine = new MediaEngine({
  timeoutMs: 15_000,
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent: "MediaEngineProviderSmoke/0.1.0",
    }),
    aniListProvider(),
    tvMazeProvider({ userAgent: "MediaEngineProviderSmoke/0.1.0" }),
    wikidataProvider(),
  ],
});

const cases = [
  searchCase(
    "movie",
    { title: "Interstellar", type: "movie" },
    ["Interstellar"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "movie",
    { title: "The Matrix", type: "movie" },
    ["Matrix"],
    ["ids", "ratings", "poster"],
  ),
  searchCase("movie", { title: "Avatar", type: "movie" }, ["Avatar"], ["ids", "poster"]),
  searchCase("movie", { title: "Dune", type: "movie" }, ["Dune"], ["ids", "poster"]),
  searchCase("movie", { title: "Fight Club", type: "movie" }, ["Fight Club"], ["ids", "ratings"]),
  searchCase(
    "series",
    { title: "Game of Thrones", type: "series" },
    ["Game of Thrones", "Игра престолов"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "series",
    { title: "Breaking Bad", type: "series" },
    ["Breaking Bad"],
    ["ids", "ratings", "poster"],
  ),
  searchCase("series", { title: "Dark", type: "series" }, ["Dark"], ["ids", "poster"]),
  searchCase(
    "series",
    { title: "House of the Dragon", type: "series" },
    ["House of the Dragon"],
    ["ids", "poster"],
  ),
  searchCase(
    "series",
    { title: "The Last of Us", type: "series" },
    ["The Last of Us"],
    ["ids", "poster"],
  ),
  searchCase(
    "anime",
    { title: "Naruto", type: "anime" },
    ["Naruto", "Наруто"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "anime",
    { title: "One Piece", type: "anime" },
    ["One Piece", "Ван-Пис"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "anime",
    { title: "Death Note", type: "anime" },
    ["Death Note", "Тетрадь смерти"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "anime",
    { title: "Attack on Titan", type: "anime" },
    ["Attack on Titan", "Shingeki"],
    ["ids", "ratings", "poster"],
  ),
  searchCase(
    "anime",
    { title: "Fullmetal Alchemist", type: "anime" },
    ["Fullmetal Alchemist", "Стальной алхимик"],
    ["ids", "ratings", "poster"],
  ),
  searchCase("any", { title: "game of" }, ["Game of Thrones", "Игра престолов"], ["ids"], {
    top: 3,
  }),
  searchCase("any", { title: "avatar" }, ["Avatar"], ["ids"], { top: 3 }),
  searchCase("any", { title: "one piece" }, ["One Piece", "Ван-Пис"], ["ids"], { top: 3 }),
  searchCase("any", { title: "dark" }, ["Dark"], ["ids"], { top: 3 }),
  searchCase("any", { title: "dune" }, ["Dune"], ["ids"], { top: 3 }),
].slice(0, limit);

const detailCases = [
  detailsCase("Game of Thrones details", { imdb: "tt0944947", type: "series" }, [
    "status",
    "episodesCount",
    "ratings",
    "ids",
  ]),
  detailsCase("Interstellar details", { imdb: "tt0816692", type: "movie" }, [
    "runtimeMinutes",
    "ratings",
    "ids",
  ]),
];

const results = [];

for (const testCase of cases) {
  results.push(await runSearchCase(testCase));
}

for (const testCase of detailCases) {
  results.push(await runDetailsCase(testCase));
}

printSummary(results);

if (strict && results.some((result) => result.status === "FAIL")) {
  process.exitCode = 1;
}

function searchCase(group, query, expectedTitles, requiredFields, options = {}) {
  return {
    kind: "search",
    group,
    query,
    expectedTitles,
    requiredFields,
    top: options.top ?? 1,
  };
}

function detailsCase(name, query, requiredFields) {
  return {
    kind: "details",
    name,
    query,
    requiredFields,
  };
}

async function runSearchCase(testCase) {
  const startedAt = Date.now();

  try {
    const response = await engine.search({ ...testCase.query, limit: Math.max(5, testCase.top) });
    const candidates = response.results.slice(0, testCase.top);
    const matched = candidates.find((result) =>
      testCase.expectedTitles.some((expectedTitle) => hasTitleMatch(result.item, expectedTitle)),
    );
    const top = response.results[0];
    const missing = top
      ? missingFields(top.item, testCase.requiredFields)
      : testCase.requiredFields;
    const status = matched && missing.length === 0 ? "PASS" : matched ? "WARN" : "FAIL";

    return {
      status,
      kind: testCase.kind,
      name: `${testCase.group}: ${testCase.query.title}`,
      tookMs: Date.now() - startedAt,
      actual: response.results
        .slice(0, 3)
        .map((result) => `${result.item.title} [${result.item.type}]`)
        .join(" | "),
      notes: [
        matched
          ? undefined
          : `expected top ${testCase.top}: ${testCase.expectedTitles.join(" / ")}`,
        missing.length ? `missing top fields: ${missing.join(", ")}` : undefined,
        response.meta.providers.failed.length
          ? `failed providers: ${response.meta.providers.failed.map((failure) => failure.provider).join(", ")}`
          : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return failureResult(
      testCase.kind,
      `${testCase.group}: ${testCase.query.title}`,
      startedAt,
      error,
    );
  }
}

async function runDetailsCase(testCase) {
  const startedAt = Date.now();

  try {
    const response = await engine.getDetails(testCase.query);
    const details = response.details;
    const missing = details
      ? missingFields(details, testCase.requiredFields)
      : testCase.requiredFields;
    const status = details && missing.length === 0 ? "PASS" : "FAIL";

    return {
      status,
      kind: testCase.kind,
      name: testCase.name,
      tookMs: Date.now() - startedAt,
      actual: details
        ? `${details.title} [${details.type}] status=${details.status ?? "n/a"} episodes=${details.episodesCount ?? "n/a"}`
        : "null",
      notes: [
        missing.length ? `missing details fields: ${missing.join(", ")}` : undefined,
        response.meta.providers.failed.length
          ? `failed providers: ${response.meta.providers.failed.map((failure) => failure.provider).join(", ")}`
          : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return failureResult(testCase.kind, testCase.name, startedAt, error);
  }
}

function failureResult(kind, name, startedAt, error) {
  return {
    status: "FAIL",
    kind,
    name,
    tookMs: Date.now() - startedAt,
    actual: "",
    notes: [error instanceof Error ? error.message : String(error)],
  };
}

function hasTitleMatch(item, expectedTitle) {
  const expected = normalize(expectedTitle);
  const titles = [item.title, item.originalTitle, ...(item.alternativeTitles ?? [])]
    .filter(Boolean)
    .map(normalize);

  return titles.some((title) => title.includes(expected) || expected.includes(title));
}

function missingFields(item, fields) {
  return fields.filter((field) => !hasField(item, field));
}

function hasField(item, field) {
  const value = item[field];

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (field === "ids") {
    return Boolean(value && Object.values(value).some(Boolean));
  }

  return value !== undefined && value !== null && value !== "";
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
  const statusOrder = { FAIL: 0, WARN: 1, PASS: 2 };
  const sorted = [...results].sort((left, right) => {
    const statusDiff = statusOrder[left.status] - statusOrder[right.status];

    return statusDiff || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
  });

  for (const result of sorted) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";
    console.log(
      `${result.status.padEnd(4)} ${result.kind.padEnd(7)} ${result.name} -> ${result.actual}${notes}`,
    );
  }

  const pass = results.filter((result) => result.status === "PASS").length;
  const warn = results.filter((result) => result.status === "WARN").length;
  const fail = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log(`Provider smoke summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);

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
