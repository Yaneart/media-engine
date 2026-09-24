#!/usr/bin/env node

import { MediaEngine } from "../packages/core/dist/index.js";
import {
  cinemetaProvider,
  kinobdProvider,
  tmdbProvider,
  wikidataProvider,
} from "../packages/providers/dist/index.js";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const cases = [
  {
    name: "Interstellar",
    type: "movie",
    title: "Interstellar",
    imdb: "tt0816692",
    knownKinopoisk: "258687",
  },
  {
    name: "Game of Thrones",
    type: "series",
    title: "Game of Thrones",
    imdb: "tt0944947",
    knownKinopoisk: "464963",
  },
  {
    name: "Frieren",
    type: "anime",
    title: "Frieren",
    aniList: "154587",
    knownKinopoisk: "5401195",
  },
];

const report = { capturedAt: new Date().toISOString(), baseUrl, cases: [], providerChecks: [] };
const health = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(5_000) });
if (!health.ok) throw new Error(`API health check failed: HTTP ${health.status}`);

for (const sample of cases) {
  const search = await request("search", {
    title: sample.title,
    type: sample.type,
    limit: 5,
    language: "en",
  });
  if (search.status !== 200)
    throw new Error(`Search failed for ${sample.name}: ${search.error ?? search.status}`);
  const results = search.body?.results ?? [];
  const selected =
    results.find(({ item }) =>
      sample.imdb ? item.ids?.imdb === sample.imdb : item.ids?.aniList === sample.aniList,
    ) ?? results[0];
  const ids = selected?.item?.ids ?? {};
  const details = await request("details", { type: sample.type, ...ids, language: "en" });
  const availability = await request("availability", {
    type: sample.type,
    title: sample.title,
    ...ids,
    providers: "initem-streaming",
  });
  const knownIdAvailability = await request("availability", {
    type: sample.type,
    kinopoisk: sample.knownKinopoisk,
    providers: "initem-streaming",
  });
  report.cases.push({
    name: sample.name,
    search: compact(search, selected),
    details: compact(details, details.body?.details),
    availability: {
      url: availability.url,
      status: availability.status,
      wallMs: availability.wallMs,
      query: availability.body?.query,
      optionCount: availability.body?.options?.length,
      meta: availability.body?.meta,
      error: availability.error,
    },
    knownIdAvailability: {
      url: knownIdAvailability.url,
      status: knownIdAvailability.status,
      wallMs: knownIdAvailability.wallMs,
      optionCount: knownIdAvailability.body?.options?.length,
      meta: knownIdAvailability.body?.meta,
      error: knownIdAvailability.error,
    },
  });
}

for (const [name, provider] of [
  ["cinemeta", cinemetaProvider()],
  ["tmdb", tmdbProvider()],
  ["kinobd", kinobdProvider()],
  ["wikidata", wikidataProvider()],
]) {
  const engine = new MediaEngine({ providers: [provider], timeoutMs: 5_000, debug: true });
  for (const sample of cases.slice(0, 2)) {
    const query = { type: sample.type, ids: { imdb: sample.imdb }, language: "en", limit: 5 };
    try {
      const response = await engine.search(query);
      report.providerChecks.push({
        provider: name,
        name: sample.name,
        query,
        results: response.results.slice(0, 3).map(({ item }) => pickItem(item)),
        meta: response.meta,
      });
    } catch (error) {
      report.providerChecks.push({
        provider: name,
        name: sample.name,
        query,
        error: String(error),
        code: error?.code,
      });
    }
  }
}

console.log(JSON.stringify(report, null, 2));

async function request(path, params) {
  const url = new URL(`/media/${path}`, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const start = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return {
      url: url.toString(),
      status: response.status,
      wallMs: Math.round(performance.now() - start),
      body: await response.json(),
    };
  } catch (error) {
    return {
      url: url.toString(),
      wallMs: Math.round(performance.now() - start),
      error: String(error),
    };
  }
}

function compact(response, selected) {
  return {
    url: response.url,
    status: response.status,
    wallMs: response.wallMs,
    resultCount: response.body?.results?.length,
    item: selected && pickItem(selected.item ?? selected),
    sources: selected?.sources,
    meta: response.body?.meta,
    error: response.error,
  };
}

function pickItem(item) {
  return { id: item.id, type: item.type, title: item.title, year: item.year, ids: item.ids };
}
