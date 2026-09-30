#!/usr/bin/env node

import { IdentityResolver, MediaEngine } from "../packages/core/dist/index.js";
import {
  shikimoriCinemaIdentitySource,
  veoVeoStreamingProvider,
  videoHubStreamingProvider,
} from "../packages/providers/dist/index.js";
import { createSmokeUserAgent } from "./smoke-user-agent.mjs";

const playbackUserAgent = createSmokeUserAgent("EpisodicAnimeSmoke");
const providers = [
  videoHubStreamingProvider({ userAgent: playbackUserAgent }),
  veoVeoStreamingProvider({ userAgent: playbackUserAgent }),
];
const animeCases = [
  animeCase("Frieren", "52991", "5401195", 1, 1, 1),
  animeCase("Solo Leveling", "52299", "5230828", 1, 1, 1),
  animeCase("Jujutsu Kaisen", "40748", "1381125", 1, 1, 1),
  animeCase("Death Note", "1535", "406148", 1, 1, 1),
];
const regressions = [
  {
    name: "Spirited Away",
    query: { type: "anime", animeKind: "movie", ids: { kinopoisk: "370" } },
  },
  { name: "Interstellar", query: { type: "movie", ids: { kinopoisk: "258687" } } },
  {
    name: "Breaking Bad S01E01",
    query: { type: "series", ids: { kinopoisk: "404900" }, seasonNumber: 1, episodeNumber: 1 },
  },
];

let failed = false;

for (const testCase of animeCases) {
  const results = await queryProviders(testCase.query);
  const mismatches = results.flatMap(({ provider, availability }) =>
    (availability?.options ?? []).flatMap((option) =>
      sameEpisode(option.episode, testCase.query) ? [] : [`${provider}:${option.id}`],
    ),
  );
  if (mismatches.length > 0) failed = true;
  print(testCase.name, results, mismatches.length ? `episode mismatch: ${mismatches.length}` : "");
}

const ambiguous = animeCases[0].query;
const ambiguousResults = await queryProviders({
  type: "anime",
  animeKind: "tv",
  ids: ambiguous.ids,
  absoluteEpisodeNumber: 1,
});
if (ambiguousResults.some(({ availability }) => availability !== null)) failed = true;
print("ambiguous absolute-only anime", ambiguousResults, "expected empty without network playback");

const missingResults = await queryProviders({ ...animeCases[0].query, episodeNumber: 99 });
if (missingResults.some(({ availability }) => (availability?.options.length ?? 0) > 0))
  failed = true;
print("missing anime episode", missingResults, "expected empty");

const validationEngine = new MediaEngine({
  identityResolver: new IdentityResolver([shikimoriCinemaIdentitySource()]),
  streamingProviders: providers,
  timeoutMs: 20_000,
});
const mismatchedIdentity = await validationEngine.getAvailability({
  ...animeCases[0].query,
  title: "Frieren",
  ids: { shikimori: "52991", kinopoisk: "1381125" },
});
if (mismatchedIdentity.options.length > 0) failed = true;
console.log(
  `mismatched anime identity: ${mismatchedIdentity.options.length} options; ` +
    `requested=${mismatchedIdentity.meta?.providers.requested.join(",") || "none"}; ` +
    `state=${mismatchedIdentity.state?.status}`,
);

for (const regression of regressions) {
  print(regression.name, await queryProviders(regression.query), "regression probe");
}

process.exitCode = failed ? 1 : 0;

function animeCase(name, shikimori, kinopoisk, seasonNumber, episodeNumber, absoluteEpisodeNumber) {
  return {
    name,
    query: {
      type: "anime",
      animeKind: "tv",
      ids: { shikimori, kinopoisk },
      seasonNumber,
      episodeNumber,
      absoluteEpisodeNumber,
    },
  };
}

async function queryProviders(query) {
  return Promise.all(
    providers.map(async (provider) => {
      const startedAt = Date.now();
      try {
        const availability = await provider.getAvailability(query, { playbackUserAgent });
        return { provider: provider.name, availability, tookMs: Date.now() - startedAt };
      } catch (error) {
        return {
          provider: provider.name,
          availability: null,
          tookMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function sameEpisode(episode, query) {
  return (
    episode?.seasonNumber === query.seasonNumber &&
    episode?.episodeNumber === query.episodeNumber &&
    episode?.absoluteEpisodeNumber === query.absoluteEpisodeNumber
  );
}

function print(name, results, note) {
  const summary = results
    .map(
      ({ provider, availability, tookMs, error }) =>
        `${provider}=${error ? `ERROR(${error})` : `${availability?.options.length ?? 0} options`} ${tookMs}ms`,
    )
    .join("; ");
  console.log(`${name}: ${summary}${note ? `; ${note}` : ""}`);
}
