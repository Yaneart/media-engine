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
import {
  SMOKE_CLASSIFICATION,
  applySmokeExitCode,
  classifySmokeError,
  createSmokeReport,
  formatSmokePolicy,
  readSmokePolicy,
} from "./smoke-policy.mjs";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const userAgent = createSmokeUserAgent("SearchQualitySmoke");

const policy = readSmokePolicy();
const matrix = readOption("--matrix") ?? "smoke";
const limit = readLimit();

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
    aniListProvider(),
    cinemetaProvider(),
    shikimoriProvider({
      userAgent,
    }),
    tvMazeProvider({ userAgent }),
    wikidataProvider(),
  ],
});

const cases = selectCases(matrix).slice(0, limit);
const results = [];

for (const testCase of cases) {
  results.push(await runQualityCase(testCase));
}

const report = createSmokeReport({
  smoke: "search-quality",
  policy,
  metadata: { matrix },
  results,
});

printReport(report);
applySmokeExitCode(report);

function selectCases(name) {
  if (name === "quick") {
    return quickCases();
  }

  if (name === "full") {
    return fullCases();
  }

  if (name !== "smoke") {
    throw new Error(`Unknown matrix "${name}". Expected smoke, quick, or full.`);
  }

  return [
    searchCase("one -> One Piece", { title: "one", limit: 10 }, onePieceExpectation(), {
      top: 3,
      minSources: 2,
      requireRating: true,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase("game -> Game of Thrones", { title: "game", limit: 20 }, gameOfThronesExpectation()),
    searchCase(
      "avatar -> Avatar",
      { title: "avatar", limit: 10 },
      {
        type: "movie",
        titles: ["Avatar"],
        ids: { imdb: "tt0499549", kinopoisk: "251733" },
      },
    ),
    searchCase("dark -> Dark", { title: "dark", limit: 10 }, darkExpectation(), {
      top: 5,
      compareDetailsPoster: true,
      detailsQuery: { type: "series", imdb: "tt5753856" },
    }),
    searchCase(
      "breaking bad",
      { title: "breaking bad", type: "series", limit: 10 },
      breakingBadExpectation(),
    ),
  ];
}

function quickCases() {
  return [
    searchCase("one -> One Piece", { title: "one", limit: 10 }, onePieceExpectation(), {
      top: 3,
      minSources: 2,
      requireRating: true,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase("ванпис -> Ван-Пис", { title: "ванпис", limit: 10 }, onePieceExpectation(), {
      top: 1,
      minSources: 2,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase(
      "game of -> Game of Thrones",
      { title: "game of", limit: 10 },
      gameOfThronesExpectation(),
      {
        top: 1,
        compareDetailsPoster: true,
        detailsQuery: { type: "series", imdb: "tt0944947", kinopoisk: "464963" },
      },
    ),
    searchCase(
      "game of throen -> Game of Thrones",
      { title: "game of throen", limit: 10 },
      gameOfThronesExpectation(),
      { top: 1 },
    ),
    searchCase(
      "house of the dragon -> House of the Dragon",
      { title: "house of the dragon", limit: 10 },
      houseOfTheDragonExpectation(),
    ),
    searchCase("dark -> Dark", { title: "dark", limit: 10 }, darkExpectation(), {
      top: 1,
      compareDetailsPoster: true,
      detailsQuery: { type: "series", imdb: "tt5753856" },
    }),
    searchCase(
      "attack on titan -> current canonical title",
      { title: "attack on titan", limit: 10 },
      attackOnTitanExpectation(),
    ),
    searchCase(
      "интерстеллар -> Интерстеллар",
      { title: "интерстеллар", limit: 10 },
      interstellarExpectation(),
      {
        top: 1,
        compareDetailsPoster: true,
        detailsQuery: { type: "movie", imdb: "tt0816692", kinopoisk: "258687" },
      },
    ),
  ];
}

function fullCases() {
  return [
    searchCase("one -> One Piece", { title: "one", limit: 10 }, onePieceExpectation(), {
      top: 3,
      minSources: 2,
      requireRating: true,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase("one piece -> One Piece", { title: "one piece", limit: 10 }, onePieceExpectation(), {
      top: 1,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase("ванпис -> Ван-Пис", { title: "ванпис", limit: 10 }, onePieceExpectation(), {
      top: 1,
      compareDetailsPoster: true,
      detailsQuery: { type: "anime", shikimori: "21", kinopoisk: "382731" },
    }),
    searchCase(
      "game of -> Game of Thrones",
      { title: "game of", limit: 10 },
      gameOfThronesExpectation(),
      {
        top: 1,
        compareDetailsPoster: true,
        detailsQuery: { type: "series", imdb: "tt0944947", kinopoisk: "464963" },
      },
    ),
    searchCase(
      "game of thrones -> Game of Thrones",
      { title: "game of thrones", limit: 10 },
      gameOfThronesExpectation(),
      {
        top: 1,
        compareDetailsPoster: true,
        detailsQuery: { type: "series", imdb: "tt0944947", kinopoisk: "464963" },
      },
    ),
    searchCase(
      "game of throen -> Game of Thrones",
      { title: "game of throen", limit: 10 },
      gameOfThronesExpectation(),
      { top: 1 },
    ),
    searchCase(
      "house of the dragon -> House of the Dragon",
      { title: "house of the dragon", limit: 10 },
      houseOfTheDragonExpectation(),
    ),
    searchCase(
      "avatar -> Avatar",
      { title: "avatar", limit: 10 },
      {
        type: "movie",
        titles: ["Avatar"],
        ids: { imdb: "tt0499549", kinopoisk: "251733" },
      },
    ),
    searchCase(
      "dune -> Dune",
      { title: "dune", limit: 10 },
      {
        type: "movie",
        titles: ["Dune", "Дюна"],
        ids: { imdb: "tt1160419", kinopoisk: "409424" },
      },
    ),
    searchCase("dark -> Dark", { title: "dark", limit: 10 }, darkExpectation(), {
      top: 1,
      compareDetailsPoster: true,
      detailsQuery: { type: "series", imdb: "tt5753856" },
    }),
    searchCase(
      "attack on titan -> current canonical title",
      { title: "attack on titan", limit: 10 },
      attackOnTitanExpectation(),
    ),
    searchCase(
      "death note -> canonical anime",
      { title: "death note", limit: 10 },
      {
        type: "anime",
        titles: ["Death Note", "Тетрадь смерти"],
        ids: { shikimori: "1535" },
      },
    ),
    searchCase(
      "fullmetal alchemist -> canonical anime",
      { title: "fullmetal alchemist", limit: 10 },
      {
        type: "anime",
        titles: ["Fullmetal Alchemist", "Стальной алхимик"],
        ids: { shikimori: "121", myAnimeList: "121" },
      },
    ),
    searchCase(
      "spirited away -> canonical anime movie",
      { title: "spirited away", limit: 10 },
      {
        type: "anime",
        titles: ["Spirited Away", "Унесённые призраками"],
        ids: { shikimori: "199", myAnimeList: "199" },
      },
    ),
    searchCase(
      "интерстеллар -> Интерстеллар",
      { title: "интерстеллар", limit: 10 },
      interstellarExpectation(),
      {
        top: 1,
        compareDetailsPoster: true,
        detailsQuery: { type: "movie", imdb: "tt0816692", kinopoisk: "258687" },
      },
    ),
    searchCase(
      "во все тяжкие -> Во все тяжкие",
      { title: "во все тяжкие", limit: 10 },
      breakingBadExpectation(),
    ),
    searchCase(
      "клан сопрано -> Клан Сопрано",
      { title: "клан сопрано", limit: 10 },
      {
        type: "series",
        titles: ["The Sopranos", "Клан Сопрано"],
        ids: { imdb: "tt0141842", kinopoisk: "79848" },
      },
    ),
  ];
}

function searchCase(name, query, expectation, options = {}) {
  return {
    name,
    query,
    expectation,
    top: options.top ?? 1,
    minSources: options.minSources ?? 1,
    requireRating: options.requireRating ?? false,
    requirePoster: options.requirePoster ?? true,
    compareDetailsPoster: options.compareDetailsPoster ?? false,
    detailsQuery: options.detailsQuery,
  };
}

async function runQualityCase(testCase) {
  try {
    const response = await engine.search(testCase.query);
    const matchIndex = response.results.findIndex((result) =>
      matchesExpectation(result.item, testCase.expectation),
    );
    const matched = matchIndex === -1 ? undefined : response.results[matchIndex];
    const rank = matchIndex === -1 ? undefined : matchIndex + 1;
    const top = response.results[0];
    const providerFailureNotes = response.meta.providers.failed.length
      ? [
          `failed providers: ${response.meta.providers.failed
            .map((failure) => `${failure.provider}:${failure.code}`)
            .join(", ")}`,
        ]
      : [];
    const rankNotes = [
      rank === undefined
        ? `missing expected identity: ${formatExpectation(testCase.expectation)}`
        : undefined,
      rank !== undefined && rank > testCase.top
        ? `rank ${rank} below top ${testCase.top}`
        : undefined,
    ].filter(Boolean);
    const deterministicNotes = [
      providerFailureNotes.length === 0 && rankNotes.length > 0 ? rankNotes.join("; ") : undefined,
      matched && matched.item.type !== testCase.expectation.type
        ? `type ${matched.item.type} != ${testCase.expectation.type}`
        : undefined,
      matched && hasDirtyDescription(matched.item) ? "dirty description marker" : undefined,
    ].filter(Boolean);
    const sourceCount = matched ? matched.sources.length : 0;
    const hasRating = Boolean(matched?.item.ratings?.length);
    const hasPoster = Boolean(matched?.item.poster?.url);
    const detailsPosterResult =
      matched && testCase.compareDetailsPoster
        ? await compareDetailsPoster(
            matched.item.poster?.url,
            testCase.detailsQuery ?? matched.item,
          )
        : undefined;
    const warningNotes = [
      matched && sourceCount < testCase.minSources
        ? `sources ${sourceCount} below ${testCase.minSources}`
        : undefined,
      matched && testCase.requireRating && !hasRating ? "missing rating" : undefined,
      matched && testCase.requirePoster && !hasPoster ? "missing poster" : undefined,
      detailsPosterResult?.status === "WARN" ? detailsPosterResult.note : undefined,
      providerFailureNotes.length > 0 && rankNotes.length > 0
        ? `${rankNotes.join("; ")} under upstream failure`
        : undefined,
      ...providerFailureNotes,
    ].filter(Boolean);
    const status =
      deterministicNotes.length > 0 ? "FAIL" : warningNotes.length > 0 ? "WARN" : "PASS";

    return {
      status,
      classification:
        status === "FAIL"
          ? SMOKE_CLASSIFICATION.contractRegression
          : status === "WARN"
            ? SMOKE_CLASSIFICATION.upstreamDegraded
            : SMOKE_CLASSIFICATION.healthy,
      name: testCase.name,
      query: testCase.query,
      tookMs: response.meta.tookMs,
      rank,
      matched: matched ? formatResult(matched) : "missing",
      top: top ? formatResult(top) : "missing",
      topResults: response.results.slice(0, 3).map((result) => formatResult(result)),
      failedProviders: response.meta.providers.failed,
      notes: [...deterministicNotes, ...warningNotes],
    };
  } catch (error) {
    const failure = classifySmokeError(error);

    return {
      ...failure,
      name: testCase.name,
      query: testCase.query,
      tookMs: 0,
      rank: undefined,
      matched: "error",
      top: "error",
      topResults: [],
      failedProviders: [],
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function compareDetailsPoster(searchPosterUrl, detailsQuery) {
  if (!searchPosterUrl) {
    return { status: "WARN", note: "search poster missing; poster equality skipped" };
  }

  const response = await engine.getDetails(detailsQuery);
  const detailsPosterUrl = response.details?.poster?.url;

  if (!detailsPosterUrl) {
    return { status: "WARN", note: "details poster missing" };
  }

  if (detailsPosterUrl !== searchPosterUrl) {
    return { status: "WARN", note: "search/details poster mismatch" };
  }

  if (response.meta.providers.failed.length) {
    return {
      status: "WARN",
      note: `details failed providers: ${response.meta.providers.failed
        .map((failure) => `${failure.provider}:${failure.code}`)
        .join(", ")}`,
    };
  }

  return { status: "PASS" };
}

function matchesExpectation(item, expectation) {
  return (
    item.type === expectation.type &&
    hasTitleMatch(item, expectation.titles) &&
    hasExpectedIdentity(item.ids, expectation.ids)
  );
}

function hasTitleMatch(item, expectedTitles) {
  const expected = expectedTitles.map(normalize);
  const titles = [item.title, item.originalTitle, ...(item.alternativeTitles ?? [])]
    .filter(Boolean)
    .map(normalize);

  return titles.some((title) =>
    expected.some(
      (expectedTitle) => title === expectedTitle || title.startsWith(`${expectedTitle}:`),
    ),
  );
}

function hasExpectedIdentity(ids, expectedIds) {
  const entries = Object.entries(expectedIds ?? {}).filter(([, value]) => Boolean(value));

  if (entries.length === 0) {
    return true;
  }

  return entries.some(([source, value]) => ids?.[source] === value);
}

function hasDirtyDescription(item) {
  const text = [item.description, item.shortDescription].filter(Boolean).join("\n").toLowerCase();

  return /<[^>]+>|undefined|null|^\s*nan\s*$/i.test(text);
}

function formatResult(result) {
  const item = result.item ?? result;
  const sources = result.sources?.map((source) => source.provider).join(",") ?? "n/a";
  const ids =
    Object.entries(item.ids ?? {})
      .map(([key, value]) => `${key}:${value}`)
      .join(",") || "none";
  const ratings = item.ratings?.map((rating) => rating.source).join(",") || "none";

  return `${item.title} [${item.type}] year=${item.year ?? "n/a"} sources=${sources} ids=${ids} ratings=${ratings} poster=${item.poster?.url ? "yes" : "no"}`;
}

function formatExpectation(expectation) {
  const ids = Object.entries(expectation.ids ?? {})
    .map(([key, value]) => `${key}:${value}`)
    .join(",");

  return `${expectation.titles.join(" / ")} [${expectation.type}]${ids ? ` ids=${ids}` : ""}`;
}

function onePieceExpectation() {
  return {
    type: "anime",
    titles: ["One Piece", "Ван-Пис"],
    ids: { shikimori: "21", kinopoisk: "382731", myAnimeList: "21" },
  };
}

function gameOfThronesExpectation() {
  return {
    type: "series",
    titles: ["Game of Thrones", "Игра престолов"],
    ids: { imdb: "tt0944947", kinopoisk: "464963" },
  };
}

function houseOfTheDragonExpectation() {
  return {
    type: "series",
    titles: ["House of the Dragon", "Дом Дракона"],
    ids: { imdb: "tt11198330", tmdb: "94997", kinopoisk: "1316601" },
  };
}

function darkExpectation() {
  return {
    type: "series",
    titles: ["Dark", "Тьма"],
    ids: { imdb: "tt5753856", tmdb: "70523", kinopoisk: "1030219" },
  };
}

function attackOnTitanExpectation() {
  return {
    type: "anime",
    titles: ["Attack on Titan", "Shingeki no Kyojin", "Атака титанов"],
    ids: { shikimori: "16498", myAnimeList: "16498" },
  };
}

function interstellarExpectation() {
  return {
    type: "movie",
    titles: ["Interstellar", "Интерстеллар"],
    ids: { imdb: "tt0816692", kinopoisk: "258687" },
  };
}

function breakingBadExpectation() {
  return {
    type: "series",
    titles: ["Breaking Bad", "Во все тяжкие"],
    ids: { imdb: "tt0903747", kinopoisk: "404900" },
  };
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

function printReport(report) {
  if (policy.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const result of report.results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";

    console.log(
      `${result.status.padEnd(4)} ${result.name} -> rank=${result.rank ?? "n/a"} ${result.matched} [${result.tookMs}ms]${notes}`,
    );
    console.log(`     top: ${result.topResults.join(" | ") || "none"}`);
  }

  const { summary } = report;

  console.log("");
  console.log(
    `Search quality ${matrix} summary: ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL`,
  );
  console.log(formatSmokePolicy(report));
}

function readLimit() {
  const value = Number(readOption("--limit"));

  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
