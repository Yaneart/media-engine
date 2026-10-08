#!/usr/bin/env node

import { kodikStreamingProvider } from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const apiKey = process.env.KODIK_API_KEY?.trim();
if (!apiKey) throw new Error("KODIK_API_KEY is required for the Kodik smoke.");

const provider = kodikStreamingProvider({
  apiKey,
  userAgent: createSmokeUserAgent("KodikStreamingSmoke"),
});
const cases = [
  positive("movie: Parasite", {
    type: "movie",
    ids: { kinopoisk: "1043758", imdb: "tt6751668" },
  }),
  positive("anime movie: Spirited Away", {
    type: "anime",
    animeKind: "movie",
    ids: { shikimori: "199", kinopoisk: "370", imdb: "tt0245429" },
  }),
  positive("series: Scandal S01E01", {
    type: "series",
    ids: { kinopoisk: "6712336", imdb: "tt36347588" },
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  positive("anime: Death Note E01", anime("1535", 1, 1, 1)),
  positive("anime: Frieren E01", anime("52991", 1, 1, 1)),
  positive("anime: Solo Leveling E01", anime("52299", 1, 1, 1)),
  positive("anime: Jujutsu Kaisen E01", anime("40748", 1, 1, 1)),
  positive("split anime: Re:Zero S02E14", {
    ...anime("42203", 2, 14, 39),
    animeReleaseEpisode: {
      releaseIndex: 2,
      releaseEpisodeNumber: 1,
      releaseEpisodeCounts: [25, 13, 12, 16, 19],
    },
  }),
  observe("catalog coverage: Interstellar", {
    type: "movie",
    ids: { kinopoisk: "258687", imdb: "tt0816692" },
  }),
  observe("catalog coverage: Game of Thrones S01E01", {
    type: "series",
    ids: { kinopoisk: "464963", imdb: "tt0944947" },
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  observe("catalog coverage: Breaking Bad S01E01", {
    type: "series",
    ids: { kinopoisk: "404900", imdb: "tt0903747" },
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  observe("catalog coverage: Shogun S01E01", {
    type: "series",
    ids: { kinopoisk: "666512", imdb: "tt2788316" },
    seasonNumber: 1,
    episodeNumber: 1,
  }),
  negative("missing work", { type: "movie", ids: { kinopoisk: "999999999999" } }),
  negative("wrong episode", anime("1535", 1, 99, 99)),
  negative("conflicting identity", {
    ...anime("1535", 1, 1, 1),
    ids: { shikimori: "1535", kinopoisk: "999999999999" },
  }),
];

let failed = false;
for (const testCase of cases) {
  const startedAt = Date.now();
  try {
    const availability = await provider.getAvailability(testCase.query, { timeoutMs: 10_000 });
    const options = availability?.options ?? [];
    const episodeMismatches = options.filter(
      (option) =>
        testCase.query.episodeNumber !== undefined &&
        (option.episode?.seasonNumber !== testCase.query.seasonNumber ||
          option.episode?.episodeNumber !== testCase.query.episodeNumber ||
          (testCase.query.absoluteEpisodeNumber !== undefined &&
            option.episode?.absoluteEpisodeNumber !== testCase.query.absoluteEpisodeNumber)),
    );
    const contractMismatch = options.some(
      (option) =>
        option.provider !== "kodik-streaming" ||
        option.discovery !== "direct" ||
        option.player.provider !== "kodik" ||
        option.player.kind !== "embed",
    );
    const passed =
      testCase.expected === "positive"
        ? options.length > 0 && episodeMismatches.length === 0 && !contractMismatch
        : testCase.expected === "negative"
          ? options.length === 0
          : episodeMismatches.length === 0 && !contractMismatch;
    if (!passed) failed = true;
    console.log(
      `${passed ? "PASS" : "FAIL"} ${testCase.name}: options=${options.length}; ` +
        `translations=${new Set(options.map((option) => option.translation?.title)).size}; ` +
        `mismatches=${episodeMismatches.length}; ${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    failed = true;
    console.log(`FAIL ${testCase.name}: ${safeErrorCode(error)}; ${Date.now() - startedAt}ms`);
  }
}

process.exitCode = failed ? 1 : 0;

function anime(shikimori, seasonNumber, episodeNumber, absoluteEpisodeNumber) {
  return {
    type: "anime",
    animeKind: "tv",
    ids: { shikimori },
    seasonNumber,
    episodeNumber,
    absoluteEpisodeNumber,
  };
}

function positive(name, query) {
  return { name, query, expected: "positive" };
}

function negative(name, query) {
  return { name, query, expected: "negative" };
}

function observe(name, query) {
  return { name, query, expected: "observe" };
}

function safeErrorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "UNEXPECTED_ERROR";
}
