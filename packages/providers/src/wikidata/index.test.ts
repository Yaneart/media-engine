import assert from "node:assert/strict";
import { test } from "node:test";

import { wikidataProvider, type WikidataProviderOptions } from "./index.js";

test("wikidataProvider validates bounded numeric options", () => {
  assert.throws(() => wikidataProvider({ searchLimit: 0 }), /Wikidata searchLimit/);
  assert.throws(() => wikidataProvider({ searchLimit: 51 }), /Wikidata searchLimit/);
  assert.throws(() => wikidataProvider({ entityLimit: 0 }), /Wikidata entityLimit/);
  assert.throws(() => wikidataProvider({ entityLimit: 11 }), /Wikidata entityLimit/);
  assert.throws(() => wikidataProvider({ cacheTtlMs: -1 }), /Wikidata cacheTtlMs/);
  assert.throws(() => wikidataProvider({ cacheMaxEntries: 1 }), /Wikidata cacheMaxEntries/);
  assert.throws(() => wikidataProvider({ cacheMaxEntries: 2_049 }), /Wikidata cacheMaxEntries/);
});

test("wikidataProvider exposes safe no-token metadata capabilities", () => {
  const provider = wikidataProvider();

  assert.equal(provider.name, "wikidata");
  assert.equal(provider.kind, "metadata");
  assert.equal(provider.searchPosterMatchesDetails, true);
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.equal(provider.capabilities.searchEnrichment, false);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb"]);
  assert.equal(provider.capabilities.search.titleDiscovery, "fallback");
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb"]);
});

test("wikidataProvider searches movies by title without api keys", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: {
        search: [
          {
            id: "Q13417189",
            label: "Interstellar",
            description: "2014 science fiction film directed by Christopher Nolan",
          },
        ],
      },
      sparql: createSparqlResponse(movieBinding()),
    }),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie", year: 2014 }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "wikidata");
  assert.equal(results[0]?.item.title, "Interstellar");
  assert.equal(results[0]?.item.type, "movie");
  assert.equal(results[0]?.item.year, 2014);
  assert.equal(results[0]?.item.ids?.imdb, "tt0816692");
  assert.equal(results[0]?.item.poster?.source, "wikidata");
  assert.equal(results[0]?.confidence, 0.8);
  assert.equal(requests[0]?.path, "/w/api.php");
  assert.equal(requests[0]?.params.get("action"), "wbsearchentities");
  assert.equal(requests[0]?.params.get("search"), "Interstellar");
  assert.equal(requests[0]?.params.get("limit"), "8");
  assert.equal(requests[1]?.path, "/sparql");
  assert.match(requests[1]?.params.get("query") ?? "", /VALUES \?item \{ wd:Q13417189 \}/);
  assert.match(requests[1]?.params.get("query") ?? "", /wdt:P31/);
  assert.match(requests[1]?.params.get("query") ?? "", /LANG\(\?requestedLabelValue\) = "en"/);
  assert.equal(requests[0]?.userAgent, "MediaEngineTest/0.0.0");
});

test("wikidataProvider filters non-movie search noise", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: {
        search: [{ id: "Q1", label: "Interstellar", description: "family name" }],
      },
      sparql: { results: { bindings: [] } },
    }),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.equal(results.length, 0);
  assert.equal(requests.length, 1);
});

test("wikidataProvider filters obvious search noise before loading bounded entities", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    entityLimit: 2,
    fetch: createMockFetch(requests, {
      search: {
        search: [
          {
            id: "Q60834962",
            label: "Dune",
            description: "2021 film directed by Denis Villeneuve",
          },
          { id: "Q25391", label: "dune", description: "landform, hill of sand" },
          { id: "Q1265597", label: "Dune", description: "1992 video game" },
          { id: "Q109300883", label: "Dune", description: "film series" },
        ],
      },
      sparql: { results: { bindings: [] } },
    }),
  });

  await provider.search({ title: "Dune", type: "movie" }, {});

  assert.equal(requests.length, 2);
  assert.match(requests[1]?.params.get("query") ?? "", /VALUES \?item \{ wd:Q60834962 \}/);
  assert.doesNotMatch(requests[1]?.params.get("query") ?? "", /wd:Q25391/);
});

test("wikidataProvider prioritizes a confirmed film behind ambiguous Avatar noise", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    entityLimit: 1,
    fetch: createMockFetch(requests, {
      search: {
        search: [
          { id: "Q790261", label: "Avatar", description: "Swedish metal band" },
          { id: "Q29387886", label: "Avatar", description: "science-fiction film series" },
          { id: "Q782823", label: "Avatar", description: "Hungarian band" },
          { id: "Q16949648", label: "Avatar", description: "1979 video game" },
          { id: "Q17014504", label: "Avatar", description: "text based virtual world (MUD)" },
          {
            id: "Q24871",
            label: "Avatar",
            description: "2009 film directed by James Cameron",
          },
        ],
      },
      sparql: createSparqlResponse(avatarBinding()),
    }),
  });

  const results = await provider.search({ title: "Avatar", type: "movie" }, {});

  assert.equal(results[0]?.item.year, 2009);
  assert.equal(results[0]?.item.ids?.imdb, "tt0499549");
  assert.match(requests[1]?.params.get("query") ?? "", /VALUES \?item \{ wd:Q24871 \}/);
});

test("wikidataProvider keeps unknown localized summaries within the entity bound", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    entityLimit: 3,
    fetch: createMockFetch(requests, {
      search: {
        search: Array.from({ length: 5 }, (_, index) => ({
          id: `Q${index + 1}`,
          label: "Неизвестный фильм",
        })),
      },
      sparql: { results: { bindings: [] } },
    }),
  });

  await provider.search({ title: "Неизвестный фильм", type: "movie" }, { language: "ru-RU" });

  assert.match(requests[1]?.params.get("query") ?? "", /VALUES \?item \{ wd:Q1 wd:Q2 wd:Q3 \}/);
  assert.match(requests[1]?.params.get("query") ?? "", /LANG\(\?requestedLabelValue\) = "ru"/);
});

test("wikidataProvider keeps films whose summaries mention their source novel", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: {
        search: [
          {
            id: "Q13417189",
            label: "Interstellar",
            description: "2014 film based on a science fiction novel",
          },
        ],
      },
      sparql: createSparqlResponse(movieBinding()),
    }),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.equal(results.length, 1);
  assert.equal(requests.length, 2);
});

test("wikidataProvider loads basic details by IMDb ID", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      sparql: createSparqlResponse(movieBinding()),
    }),
  });

  const details = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(details?.provider, "wikidata");
  assert.equal(details?.details.title, "Interstellar");
  assert.equal(details?.details.type, "movie");
  assert.equal(details?.details.ids?.imdb, "tt0816692");
  assert.equal(details?.details.sourceProviders?.[0]?.provider, "wikidata");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "/sparql");
  assert.match(requests[0]?.params.get("query") ?? "", /wdt:P345 "tt0816692"/);
  assert.match(requests[0]?.params.get("query") ?? "", /wdt:P577/);
});

test("wikidataProvider reuses bounded entity and IMDb mapping cache entries", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      sparql: createSparqlResponse(movieBinding()),
    }),
  });
  const query = { ids: { imdb: "tt0816692" }, type: "movie" } as const;

  await provider.getDetails?.(query, {});
  await provider.getDetails?.(query, {});

  assert.equal(requests.length, 1);
});

test("wikidataProvider reuses title-search identity for a following IMDb details lookup", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: {
        search: [
          {
            id: "Q13417189",
            label: "Interstellar",
            description: "2014 science fiction film",
          },
        ],
      },
      sparql: createSparqlResponse(movieBinding()),
    }),
  });

  await provider.search({ title: "Interstellar", type: "movie" }, {});
  const details = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(details?.details.title, "Interstellar");
  assert.equal(requests.length, 2);
});

test("wikidataProvider caches successful missing IMDb mappings", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      sparql: { results: { bindings: [] } },
    }),
  });

  await provider.getDetails?.({ ids: { imdb: "tt0000000" }, type: "movie" }, {});
  await provider.getDetails?.({ ids: { imdb: "tt0000000" }, type: "movie" }, {});

  assert.equal(requests.length, 1);
});

test("wikidataProvider cache can be disabled with a zero TTL", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    cacheTtlMs: 0,
    fetch: createMockFetch(requests, {
      sparql: createSparqlResponse(movieBinding()),
    }),
  });
  const query = { ids: { imdb: "tt0816692" }, type: "movie" } as const;

  await provider.getDetails?.(query, {});
  await provider.getDetails?.(query, {});

  assert.equal(requests.length, 2);
});

test("wikidataProvider keeps localized entity cache entries separate", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      sparql: createSparqlResponse(movieBinding()),
    }),
  });
  const query = { ids: { imdb: "tt0816692" }, type: "movie" } as const;

  await provider.getDetails?.(query, { language: "en-US" });
  await provider.getDetails?.(query, { language: "ru-RU" });

  assert.equal(requests.length, 2);
  assert.match(requests[0]?.params.get("query") ?? "", /LANG\(\?requestedLabelValue\) = "en"/);
  assert.match(requests[1]?.params.get("query") ?? "", /LANG\(\?requestedLabelValue\) = "ru"/);
});

test("wikidataProvider bounds its combined entity and IMDb mapping cache", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    cacheMaxEntries: 2,
    fetch: createMockFetch(requests, {
      sparql: (url: URL) =>
        createSparqlResponse(
          (url.searchParams.get("query") ?? "").includes("tt1160419")
            ? duneBinding()
            : movieBinding(),
        ),
    }),
  });

  await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});
  await provider.getDetails?.({ ids: { imdb: "tt1160419" }, type: "movie" }, {});
  await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(requests.length, 3);
});

test("wikidataProvider normalizes untrusted language and entity identifiers before SPARQL", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: {
        search: [
          { id: "Q1 } UNION { ?item ?p ?o", label: "Interstellar" },
          { id: "Q13417189", label: "Interstellar" },
        ],
      },
      sparql: createSparqlResponse(movieBinding()),
    }),
  });

  await provider.search(
    { title: "Interstellar", type: "movie" },
    { language: 'en") } UNION { ?item ?p ?o' },
  );

  assert.equal(requests[0]?.params.get("language"), "en");
  assert.match(requests[1]?.params.get("query") ?? "", /VALUES \?item \{ wd:Q13417189 \}/);
  assert.doesNotMatch(requests[1]?.params.get("query") ?? "", /UNION/);
});

test("wikidataProvider applies a narrow response-size bound", async () => {
  const provider = createProvider({
    fetch: async () =>
      new Response("{}", {
        headers: { "content-length": String(256 * 1_024 + 1) },
      }),
  });

  await assert.rejects(
    provider.search({ title: "Interstellar", type: "movie" }, {}),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );
});

test("wikidataProvider does not negative-cache malformed SPARQL responses", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, { sparql: {} }),
  });
  const query = { ids: { imdb: "tt0816692" }, type: "movie" } as const;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => provider.getDetails!(query, {}),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "PROVIDER_INVALID_RESPONSE",
    );
  }

  assert.equal(requests.length, 2);
});

function createProvider(options: Partial<WikidataProviderOptions>) {
  return wikidataProvider({
    baseUrl: "https://wikidata.test",
    sparqlUrl: "https://query.wikidata.test/sparql",
    userAgent: "MediaEngineTest/0.0.0",
    ...options,
  });
}

function movieBinding() {
  return {
    item: { value: "http://www.wikidata.org/entity/Q13417189" },
    instances: { value: "http://www.wikidata.org/entity/Q11424" },
    imdb: { value: "tt0816692" },
    releaseDate: { value: "2014-10-26T00:00:00Z" },
    image: {
      value: "https://commons.wikimedia.org/wiki/Special:FilePath/Interstellar_film_poster.jpg",
    },
    originalTitle: { value: "Interstellar" },
    requestedLabel: { value: "Interstellar" },
    englishLabel: { value: "Interstellar" },
    requestedDescription: {
      value: "2014 science fiction film directed by Christopher Nolan",
    },
    englishDescription: {
      value: "2014 science fiction film directed by Christopher Nolan",
    },
  };
}

function duneBinding() {
  return {
    ...movieBinding(),
    item: { value: "http://www.wikidata.org/entity/Q60834962" },
    imdb: { value: "tt1160419" },
    releaseDate: { value: "2021-09-03T00:00:00Z" },
    originalTitle: { value: "Dune" },
    requestedLabel: { value: "Dune" },
    englishLabel: { value: "Dune" },
  };
}

function avatarBinding() {
  return {
    ...movieBinding(),
    item: { value: "http://www.wikidata.org/entity/Q24871" },
    imdb: { value: "tt0499549" },
    releaseDate: { value: "2009-12-10T00:00:00Z" },
    originalTitle: { value: "Avatar" },
    requestedLabel: { value: "Avatar" },
    englishLabel: { value: "Avatar" },
  };
}

function createSparqlResponse(
  binding:
    | ReturnType<typeof movieBinding>
    | ReturnType<typeof duneBinding>
    | ReturnType<typeof avatarBinding>,
) {
  return {
    results: { bindings: [binding] },
  };
}

interface RequestRecord {
  path: string;
  params: URLSearchParams;
  userAgent: string | null;
}

function createMockFetch(
  requests: RequestRecord[],
  responses: {
    search?: MockResponse;
    sparql?: MockResponse;
  },
) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      userAgent: new Headers(init?.headers).get("user-agent"),
    });

    if (url.pathname === "/w/api.php") {
      return Response.json(resolveMockResponse(responses.search, url, { search: [] }));
    }

    if (url.pathname === "/sparql") {
      return Response.json(
        resolveMockResponse(responses.sparql, url, { results: { bindings: [] } }),
      );
    }

    return new Response("Not found", { status: 404 });
  };
}

type MockResponse = unknown | ((url: URL) => unknown);

function resolveMockResponse(response: MockResponse, url: URL, fallback: unknown): unknown {
  return typeof response === "function" ? response(url) : (response ?? fallback);
}
