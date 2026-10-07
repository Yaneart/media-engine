#!/usr/bin/env node

import { MediaEngine, MemoryCache, ProviderError } from "../packages/core/dist/index.js";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriGraphqlProvider,
  shikimoriProvider,
  tmdbOfficialProvider,
  tmdbProvider,
} from "../packages/providers/dist/index.js";

const apiKey = process.env.TMDB_API_KEY?.trim();
const userAgent = process.env.MEDIA_ENGINE_SHIKIMORI_USER_AGENT?.trim();
if (!apiKey || !userAgent) {
  throw new Error(
    "TMDB_API_KEY and MEDIA_ENGINE_SHIKIMORI_USER_AGENT are required in the process environment.",
  );
}

const iterations = readPositiveInteger("--iterations", 5);
const budgets = { cold: 2_500, warm: 100, stale: 250, degraded: 6_000 };
const cases = [
  metadataCase("Interstellar", "tmdb-official", "Интерстеллар", {
    type: "movie",
    ids: { tmdb: "157336", imdb: "tt0816692" },
  }),
  metadataCase("Parasite", "tmdb-official", "Паразиты", {
    type: "movie",
    ids: { tmdb: "496243", imdb: "tt6751668" },
  }),
  metadataCase("Game of Thrones", "tmdb-official", "Игра Престолов", {
    type: "series",
    ids: { tmdb: "1399", imdb: "tt0944947" },
  }),
  metadataCase("Breaking Bad", "tmdb-official", "Во все тяжкие", {
    type: "series",
    ids: { tmdb: "1396", imdb: "tt0903747" },
  }),
  metadataCase("Shogun", "tmdb-official", "Shōgun", {
    type: "series",
    ids: { tmdb: "126308", imdb: "tt2788316" },
  }),
  metadataCase("Death Note", "shikimori-graphql", "Тетрадь смерти", {
    type: "anime",
    ids: { shikimori: "1535", myAnimeList: "1535" },
  }),
  metadataCase("Frieren", "shikimori-graphql", "Провожающая в последний путь Фрирен", {
    type: "anime",
    ids: { shikimori: "52991", myAnimeList: "52991" },
  }),
  metadataCase("Solo Leveling", "shikimori-graphql", "Поднятие уровня в одиночку", {
    type: "anime",
    ids: { shikimori: "52299", myAnimeList: "52299" },
  }),
  metadataCase("Jujutsu Kaisen", "shikimori-graphql", "Магическая битва", {
    type: "anime",
    ids: { shikimori: "40748", myAnimeList: "40748" },
  }),
  metadataCase(
    "Re:Zero split season",
    "shikimori-graphql",
    "Re:Zero. Жизнь с нуля в альтернативном мире 2. Часть 2",
    {
      type: "anime",
      ids: { shikimori: "42203", myAnimeList: "42203" },
    },
  ),
  metadataCase("Spirited Away", "shikimori-graphql", "Унесённые призраками", {
    type: "anime",
    ids: { shikimori: "199", myAnimeList: "199" },
  }),
];

const failures = [];
const cold = [];
const warm = [];
const stale = [];
const searchCold = [];
const searchWarm = [];
const searchStale = [];
const degraded = [];
const incidentalDegraded = [];

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const testCase of cases) {
    const engine = createProductionEngine(new MemoryCache());
    const coldSample = await measureSafely(() => engine.getDetails(testCase.query));
    if (coldSample.error) {
      failures.push(`${testCase.name} cold request failed with ${safeErrorCode(coldSample.error)}`);
      continue;
    }
    if (coldSample.value.meta.metadata?.route === "primary") {
      validateHealthy(coldSample.value, testCase, "cold", failures);
      cold.push(sample(testCase, iteration, coldSample));
    } else {
      validateFallback(coldSample.value, testCase, "cold", failures);
      incidentalDegraded.push(sample(testCase, iteration, coldSample));
    }

    const warmSample = await measureSafely(() => engine.getDetails(testCase.query));
    if (warmSample.error) {
      failures.push(`${testCase.name} warm request failed with ${safeErrorCode(warmSample.error)}`);
      continue;
    }
    validateDetails(warmSample.value.details, testCase, "warm", failures);
    if (warmSample.value.meta.cached !== true) {
      failures.push(`${testCase.name} warm response was not served from cache`);
    }
    warm.push(sample(testCase, iteration, warmSample));
  }
}

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const testCase of cases) {
    const engine = createProductionEngine(new MemoryCache());
    const query = searchQuery(testCase);
    const coldSample = await measureSafely(() => engine.search(query));
    if (coldSample.error) {
      failures.push(`${testCase.name} cold search failed with ${safeErrorCode(coldSample.error)}`);
      continue;
    }
    validateSearch(coldSample.value, testCase, "cold", failures);
    const healthy = hasOnlyPrimary(coldSample.value, testCase);
    (healthy ? searchCold : incidentalDegraded).push(
      sample(testCase, iteration, coldSample, "search"),
    );
    if (!healthy && coldSample.ms > budgets.degraded) {
      failures.push(`${testCase.name} cold search fallback exceeded ${budgets.degraded}ms`);
    }

    const warmSample = await measureSafely(() => engine.search(query));
    if (warmSample.error) {
      failures.push(`${testCase.name} warm search failed with ${safeErrorCode(warmSample.error)}`);
      continue;
    }
    validateSearch(warmSample.value, testCase, "warm", failures);
    if (warmSample.value.meta.cached !== true) {
      failures.push(`${testCase.name} warm search was not served from cache`);
    }
    searchWarm.push(sample(testCase, iteration, warmSample, "search"));
  }
}

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const testCase of cases) {
    let now = 0;
    let degradedPrimary = false;
    const pending = [];
    const providers = createPrimaryProviders().map((provider) => ({
      ...provider,
      async getDetails(query, context) {
        const operation = degradedPrimary
          ? Promise.reject(
              new ProviderError({
                provider: provider.name,
                code: "PROVIDER_UNAVAILABLE",
                message: "Injected RP-005 primary outage.",
                retryable: true,
              }),
            )
          : Promise.resolve(provider.getDetails(query, context));
        pending.push(operation.catch(() => undefined));
        return operation;
      },
    }));
    const engine = new MediaEngine({
      cache: new MemoryCache({ now: () => now }),
      providers,
      providerTimeouts: { "tmdb-official": 2_000, "shikimori-graphql": 2_000 },
    });
    const seeded = await seedWithRetry(engine, testCase.query);
    validateHealthy(seeded, testCase, "stale seed", failures);
    now = 5 * 60_000 + 1;
    degradedPrimary = true;

    const staleSample = await measure(() => engine.getDetails(testCase.query));
    if (
      staleSample.value.meta.stale !== true ||
      staleSample.value.meta.metadata?.freshness !== "stale" ||
      staleSample.value.meta.cached !== true
    ) {
      failures.push(`${testCase.name} did not return a verified stale cache response`);
    }
    validateDetails(staleSample.value.details, testCase, "stale", failures);
    stale.push(sample(testCase, iteration, staleSample));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.allSettled(pending);
  }
}

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const testCase of cases) {
    let now = 0;
    let degradedPrimary = false;
    const pending = [];
    const providers = createPrimaryProviders().map((provider) => ({
      ...provider,
      async search(query, context) {
        const operation = degradedPrimary
          ? Promise.reject(
              new ProviderError({
                provider: provider.name,
                code: "PROVIDER_UNAVAILABLE",
                message: "Injected RP-005 primary outage.",
                retryable: true,
              }),
            )
          : Promise.resolve(provider.search(query, context));
        pending.push(operation.catch(() => undefined));
        return operation;
      },
    }));
    const engine = new MediaEngine({
      cache: new MemoryCache({ now: () => now }),
      providers,
      providerTimeouts: { "tmdb-official": 2_000, "shikimori-graphql": 2_000 },
    });
    const query = searchQuery(testCase);
    const seeded = await seedSearchWithRetry(engine, query);
    validateSearch(seeded, testCase, "stale seed", failures);
    now = 5 * 60_000 + 1;
    degradedPrimary = true;

    const staleSample = await measure(() => engine.search(query));
    if (staleSample.value.meta.stale !== true || staleSample.value.meta.cached !== true) {
      failures.push(`${testCase.name} search did not return a verified stale cache response`);
    }
    validateSearch(staleSample.value, testCase, "stale", failures);
    searchStale.push(sample(testCase, iteration, staleSample, "search"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.allSettled(pending);
  }
}

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const testCase of [cases[0], cases[5]]) {
    const providers = [
      ...createFailingPrimaryProviders(),
      tmdbProvider(),
      kinobdProvider(),
      cinemetaProvider(),
      shikimoriProvider({ userAgent }),
      aniListProvider(),
    ];
    const engine = new MediaEngine({
      cache: new MemoryCache(),
      providers,
      timeoutMs: budgets.degraded,
      providerTimeouts: {
        "tmdb-official": 2_000,
        "shikimori-graphql": 2_000,
        tmdb: 3_500,
        kinobd: 3_500,
        cinemeta: 3_500,
        shikimori: 3_500,
        anilist: 3_500,
      },
    });
    const degradedSample = await measureSafely(() => engine.getDetails(testCase.query));
    if (degradedSample.error) {
      failures.push(
        `${testCase.name} degraded request failed with ${safeErrorCode(degradedSample.error)}`,
      );
      continue;
    }
    validateDetails(degradedSample.value.details, testCase, "degraded", failures);
    if (degradedSample.value.meta.metadata?.route !== "fallback") {
      failures.push(`${testCase.name} did not report fallback provenance during primary outage`);
    }
    if (
      !degradedSample.value.meta.warnings?.some(({ code }) => code === "METADATA_FALLBACK_USED")
    ) {
      failures.push(`${testCase.name} did not report METADATA_FALLBACK_USED`);
    }
    degraded.push(sample(testCase, iteration, degradedSample));
  }
}

const paths = {
  detailsCold: summarize(cold, budgets.cold),
  detailsWarm: summarize(warm, budgets.warm),
  detailsStale: summarize(stale, budgets.stale),
  searchCold: summarize(searchCold, budgets.cold),
  searchWarm: summarize(searchWarm, budgets.warm),
  searchStale: summarize(searchStale, budgets.stale),
  degraded: summarize(degraded, budgets.degraded),
};
for (const [path, summary] of Object.entries(paths)) {
  if (summary.p95Ms > summary.budgetMs) {
    failures.push(`${path} p95 ${summary.p95Ms}ms exceeded ${summary.budgetMs}ms`);
  }
}

console.log(
  JSON.stringify(
    {
      gate: "RP-005 metadata performance and resilience",
      iterations,
      cases: cases.length,
      paths,
      healthyPrimarySamples: { details: cold.length, search: searchCold.length },
      incidentalDegraded: incidentalDegraded.map(
        ({ name, iteration, operation, ms, route, providers }) => ({
          name,
          iteration,
          operation,
          ms,
          route,
          providers,
        }),
      ),
      degradedSamples: degraded.map(({ name, iteration, ms, route, providers }) => ({
        name,
        iteration,
        ms,
        route,
        providers,
      })),
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;

function metadataCase(name, provider, searchTitle, query) {
  return { name, provider, searchTitle, query: { ...query, language: "ru" } };
}

function searchQuery(testCase) {
  return { title: testCase.searchTitle, type: testCase.query.type, language: "ru", limit: 5 };
}

function createPrimaryProviders() {
  return [tmdbOfficialProvider({ apiKey }), shikimoriGraphqlProvider({ userAgent })];
}

function createPrimaryEngine(cache) {
  return new MediaEngine({
    cache,
    providers: createPrimaryProviders(),
    providerTimeouts: { "tmdb-official": 2_000, "shikimori-graphql": 2_000 },
  });
}

function createProductionEngine(cache) {
  return new MediaEngine({
    cache,
    providers: [
      ...createPrimaryProviders(),
      tmdbProvider(),
      kinobdProvider(),
      cinemetaProvider(),
      shikimoriProvider({ userAgent }),
      aniListProvider(),
    ],
    timeoutMs: budgets.degraded,
    providerTimeouts: {
      "tmdb-official": 2_000,
      "shikimori-graphql": 2_000,
      tmdb: 3_500,
      kinobd: 3_500,
      cinemeta: 3_500,
      shikimori: 3_500,
      anilist: 3_500,
    },
  });
}

function createFailingPrimaryProviders() {
  return createPrimaryProviders().map((provider) => ({
    ...provider,
    getDetails() {
      throw new ProviderError({
        provider: provider.name,
        code: "PROVIDER_UNAVAILABLE",
        message: "Injected RP-005 primary outage.",
        retryable: true,
      });
    },
  }));
}

function validateHealthy(response, testCase, path, output) {
  validateDetails(response.details, testCase, path, output);
  if (response.meta.metadata?.route !== "primary") {
    output.push(`${testCase.name} ${path} response did not use the primary route`);
  }
  if (
    response.meta.providers.requested.length !== 1 ||
    response.meta.providers.requested[0] !== testCase.provider
  ) {
    output.push(`${testCase.name} ${path} requested unrelated metadata providers`);
  }
  if (response.meta.providers.requested.includes("kinobd")) {
    output.push(`${testCase.name} ${path} kept KinoBD on the healthy critical path`);
  }
}

function validateFallback(response, testCase, path, output) {
  validateDetails(response.details, testCase, path, output);
  if (response.meta.metadata?.route !== "fallback") {
    output.push(`${testCase.name} ${path} did not report fallback provenance`);
  }
  if (!response.meta.warnings?.some(({ code }) => code === "METADATA_FALLBACK_USED")) {
    output.push(`${testCase.name} ${path} did not report METADATA_FALLBACK_USED`);
  }
  if (response.meta.tookMs > budgets.degraded) {
    output.push(`${testCase.name} ${path} fallback exceeded ${budgets.degraded}ms`);
  }
}

function validateSearch(response, testCase, path, output) {
  const [namespace, id] = Object.entries(testCase.query.ids).find(([key]) =>
    testCase.provider === "tmdb-official" ? key === "tmdb" : key === "shikimori",
  );
  const match = response.results.find(({ item }) => item.ids?.[namespace] === id);
  if (!match) {
    output.push(`${testCase.name} ${path} search did not return ${namespace}:${id}`);
    return;
  }
  if (
    !match.item.title?.trim() ||
    !match.item.year ||
    !match.item.poster?.url?.startsWith("https://")
  ) {
    output.push(`${testCase.name} ${path} search returned an incomplete localized item`);
  }
  if (match.item.type !== testCase.query.type) {
    output.push(
      `${testCase.name} ${path} search changed ${testCase.query.type} to ${match.item.type}`,
    );
  }
  if (hasOnlyPrimary(response, testCase) && response.meta.providers.requested.includes("kinobd")) {
    output.push(`${testCase.name} ${path} search kept KinoBD on the healthy critical path`);
  }
}

function hasOnlyPrimary(response, testCase) {
  return (
    response.meta.providers.requested.length === 1 &&
    response.meta.providers.requested[0] === testCase.provider
  );
}

function validateDetails(details, testCase, path, output) {
  if (!details) {
    output.push(`${testCase.name} ${path} returned no details`);
    return;
  }
  const complete =
    details.title?.trim() &&
    details.description?.trim() &&
    details.year &&
    details.poster?.url?.startsWith("https://") &&
    details.backdrop?.url?.startsWith("https://");
  if (!complete) output.push(`${testCase.name} ${path} returned an incomplete Russian snapshot`);
  if (details.type !== testCase.query.type) {
    output.push(`${testCase.name} ${path} changed ${testCase.query.type} to ${details.type}`);
  }
  for (const [namespace, id] of Object.entries(testCase.query.ids)) {
    if (details.ids?.[namespace] !== id) {
      output.push(`${testCase.name} ${path} changed ${namespace}:${id}`);
    }
  }
}

function sample(testCase, iteration, measurement, operation = "details") {
  return {
    name: testCase.name,
    iteration,
    operation,
    ms: measurement.ms,
    route: measurement.value.meta.metadata?.route,
    providers: measurement.value.meta.providers.requested,
  };
}

function summarize(samples, budgetMs) {
  const values = samples.map(({ ms }) => ms).sort((left, right) => left - right);
  return {
    samples: values.length,
    minMs: values[0],
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.at(-1),
    budgetMs,
    passed: percentile(values, 0.95) <= budgetMs,
  };
}

function percentile(sortedValues, quantile) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * quantile) - 1)];
}

async function measure(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, ms: Math.round(performance.now() - startedAt) };
}

async function measureSafely(operation) {
  const startedAt = performance.now();
  try {
    return { value: await operation(), ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { error, ms: Math.round(performance.now() - startedAt) };
  }
}

async function seedWithRetry(engine, query) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await engine.getDetails(query);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function seedSearchWithRetry(engine, query) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await engine.search(query);
      if (response.results.length > 0) return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Search seed returned no results.");
}

function safeErrorCode(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "ERROR";
}

function readPositiveInteger(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}
