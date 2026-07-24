#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  bitsearchTorrentProvider,
  jacRedTorrentProvider,
  magnetzTorrentProvider,
  ytsTorrentProvider,
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

const INFO_HASH = /^[a-f\d]{40}$/iu;
const policy = readSmokePolicy();
const passes = readPasses();
const userAgent = createSmokeUserAgent("TorrentSourceSmoke");
const providers = [
  ytsTorrentProvider({ userAgent }),
  jacRedTorrentProvider({ userAgent }),
  bitsearchTorrentProvider({ userAgent }),
  magnetzTorrentProvider({ userAgent }),
];
const providerNames = providers.map((provider) => provider.name);
const engine = new MediaEngine({
  torrentProviders: providers,
  timeoutMs: 20_000,
  providerTimeouts: {
    "yts-torrent": 15_000,
    "jacred-torrent": 20_000,
    "bitsearch-torrent": 15_000,
    "magnetz-torrent": 15_000,
  },
  debug: true,
});

const cases = [
  torrentCase("movie: Inception", {
    type: "movie",
    title: "Inception",
    year: 2010,
    ids: { imdb: "tt1375666" },
  }),
  torrentCase("movie: Dune", {
    type: "movie",
    title: "Dune",
    year: 2021,
    ids: { imdb: "tt1160419" },
  }),
  torrentCase("movie: Интерстеллар", {
    type: "movie",
    title: "Интерстеллар",
    year: 2014,
    ids: { imdb: "tt0816692" },
    language: "ru",
  }),
  torrentCase("series: Game of Thrones S01", {
    type: "series",
    title: "Game of Thrones",
    year: 2011,
    seasonNumber: 1,
  }),
  torrentCase(
    "episode: Game of Thrones S01E10",
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 10,
    },
    { minimumCandidates: 1 },
  ),
  torrentCase("anime: Attack on Titan S01", {
    type: "anime",
    title: "Attack on Titan",
    year: 2013,
    seasonNumber: 1,
  }),
  torrentCase(
    "missing control",
    {
      type: "movie",
      title: "Media Engine Missing Control Zqxjv",
      year: 2099,
    },
    { expectEmpty: true },
  ),
];

const results = [];
const overlapPairs = new Map();
let rawCandidates = 0;
let uniqueHashes = 0;
let duplicateCandidates = 0;

for (let pass = 1; pass <= passes; pass += 1) {
  for (const testCase of cases) {
    results.push(await runTorrentCase(testCase, pass));
  }
}

const report = createSmokeReport({
  smoke: "torrent-sources",
  policy,
  metadata: {
    passes,
    providers: providerNames,
    totals: {
      rawCandidates,
      uniqueHashes,
      duplicateCandidates,
      overlapPairs: Object.fromEntries([...overlapPairs].sort()),
    },
  },
  results,
});

printReport(report);
applySmokeExitCode(report);

function torrentCase(name, query, options = {}) {
  return {
    kind: "torrents",
    name,
    query,
    expectEmpty: options.expectEmpty ?? false,
    minimumCandidates: options.minimumCandidates ?? 1,
  };
}

async function runTorrentCase(testCase, pass) {
  const startedAt = Date.now();

  try {
    const response = await engine.discoverTorrents(testCase.query);
    const hashGroups = groupCandidatesByHash(response.candidates);
    const invalidCandidates = response.candidates.filter(
      (candidate) =>
        !candidate.infoHash ||
        !INFO_HASH.test(candidate.infoHash) ||
        candidate.handoff.kind !== "magnet" ||
        !candidate.handoff.uri.toUpperCase().includes(candidate.infoHash.toUpperCase()),
    );
    const attributedProviders = new Set(response.sourceProviders.map((source) => source.provider));
    const missingAttribution = [
      ...new Set(
        response.candidates
          .map((candidate) => candidate.provider)
          .filter((provider) => !attributedProviders.has(provider)),
      ),
    ];
    const unexpectedResults = testCase.expectEmpty && response.candidates.length > 0;
    const insufficientResults =
      !testCase.expectEmpty && hashGroups.size < testCase.minimumCandidates;
    const failedProviders = response.meta?.providers.failed ?? [];
    const contractRegression =
      invalidCandidates.length > 0 || missingAttribution.length > 0 || unexpectedResults;
    const upstreamDegraded = failedProviders.length > 0 || insufficientResults;
    const status = contractRegression ? "FAIL" : upstreamDegraded ? "WARN" : "PASS";
    const providerCounts = countCandidatesByProvider(response.candidates);
    const duplicates = response.candidates.length - hashGroups.size;

    rawCandidates += response.candidates.length;
    uniqueHashes += hashGroups.size;
    duplicateCandidates += duplicates;
    recordOverlapPairs(hashGroups);

    return {
      status,
      classification: contractRegression
        ? SMOKE_CLASSIFICATION.contractRegression
        : upstreamDegraded
          ? SMOKE_CLASSIFICATION.upstreamDegraded
          : SMOKE_CLASSIFICATION.healthy,
      kind: testCase.kind,
      name: `pass ${pass}: ${testCase.name}`,
      tookMs: Date.now() - startedAt,
      actual: `raw=${response.candidates.length} uniqueHashes=${hashGroups.size} duplicates=${duplicates} providers=${formatProviderCounts(providerCounts)}`,
      notes: [
        invalidCandidates.length > 0
          ? `invalid candidates: ${invalidCandidates.length}`
          : undefined,
        missingAttribution.length > 0
          ? `missing attribution: ${missingAttribution.join(", ")}`
          : undefined,
        unexpectedResults ? "expected an honest empty response" : undefined,
        insufficientResults
          ? `expected at least ${testCase.minimumCandidates} unique hashes`
          : undefined,
        failedProviders.length > 0
          ? `failed providers: ${failedProviders
              .map((failure) => `${failure.provider}:${failure.code}`)
              .join(", ")}`
          : undefined,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      ...classifySmokeError(error),
      kind: testCase.kind,
      name: `pass ${pass}: ${testCase.name}`,
      tookMs: Date.now() - startedAt,
      actual: "",
      notes: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function groupCandidatesByHash(candidates) {
  const groups = new Map();

  for (const candidate of candidates) {
    if (!candidate.infoHash) continue;

    const hash = candidate.infoHash.toUpperCase();
    const group = groups.get(hash) ?? [];
    group.push(candidate);
    groups.set(hash, group);
  }

  return groups;
}

function recordOverlapPairs(hashGroups) {
  for (const candidates of hashGroups.values()) {
    const names = [...new Set(candidates.map((candidate) => candidate.provider))].sort();

    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const key = `${names[left]}|${names[right]}`;
        overlapPairs.set(key, (overlapPairs.get(key) ?? 0) + 1);
      }
    }
  }
}

function countCandidatesByProvider(candidates) {
  const counts = new Map(providerNames.map((provider) => [provider, 0]));

  for (const candidate of candidates) {
    counts.set(candidate.provider, (counts.get(candidate.provider) ?? 0) + 1);
  }

  return counts;
}

function formatProviderCounts(counts) {
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([provider, count]) => `${provider}:${count}`)
    .join(",");
}

function printReport(value) {
  if (policy.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  for (const result of value.results) {
    const notes = result.notes.length ? ` (${result.notes.join("; ")})` : "";
    console.log(
      `${result.status.padEnd(4)} ${result.name} -> ${result.actual}${notes} [${result.tookMs}ms]`,
    );
  }

  console.log("");
  console.log(
    `Torrent source totals: raw=${value.totals.rawCandidates} uniqueHashes=${value.totals.uniqueHashes} duplicates=${value.totals.duplicateCandidates}`,
  );
  console.log(`Overlap pairs: ${JSON.stringify(value.totals.overlapPairs)}`);
  console.log(
    `Torrent source smoke summary: ${value.summary.pass} PASS, ${value.summary.warn} WARN, ${value.summary.fail} FAIL`,
  );
  console.log(formatSmokePolicy(value));
}

function readPasses() {
  const indexes = process.argv.flatMap((value, index) => (value === "--passes" ? [index] : []));

  if (indexes.length === 0) return 1;
  if (indexes.length > 1) throw new TypeError("--passes may be provided only once.");

  const value = Number(process.argv[indexes[0] + 1]);

  if (!Number.isSafeInteger(value) || value < 1 || value > 3) {
    throw new TypeError("--passes requires an integer between 1 and 3.");
  }

  return value;
}
