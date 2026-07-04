import assert from "node:assert/strict";
import { test } from "node:test";

import { wikidataProvider, type WikidataProviderOptions } from "./index.js";

test("wikidataProvider exposes safe no-token metadata capabilities", () => {
  const provider = wikidataProvider();

  assert.equal(provider.name, "wikidata");
  assert.equal(provider.kind, "metadata");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb"]);
});

test("wikidataProvider searches movies by title without api keys", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      search: { search: [{ id: "Q13417189" }] },
      entities: createEntityResponse(movieEntity()),
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
  assert.equal(requests[1]?.params.get("action"), "wbgetentities");
  assert.equal(requests[1]?.params.get("ids"), "Q13417189");
  assert.equal(requests[0]?.userAgent, "MediaEngineTest/0.0.0");
});

test("wikidataProvider filters non-movie search noise", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      search: { search: [{ id: "Q1" }] },
      entities: createEntityResponse({
        id: "Q1",
        labels: { en: { value: "Interstellar" } },
        claims: {
          P31: [entityClaim("Q5")],
        },
      }),
    }),
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.equal(results.length, 0);
});

test("wikidataProvider loads basic details by IMDb ID", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      sparql: {
        results: {
          bindings: [{ item: { value: "http://www.wikidata.org/entity/Q13417189" } }],
        },
      },
      entities: createEntityResponse(movieEntity()),
    }),
  });

  const details = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(details?.provider, "wikidata");
  assert.equal(details?.details.title, "Interstellar");
  assert.equal(details?.details.type, "movie");
  assert.equal(details?.details.ids?.imdb, "tt0816692");
  assert.equal(details?.details.sourceProviders?.[0]?.provider, "wikidata");
  assert.equal(requests[0]?.path, "/sparql");
  assert.match(requests[0]?.params.get("query") ?? "", /wdt:P345 "tt0816692"/);
});

function createProvider(options: Partial<WikidataProviderOptions>) {
  return wikidataProvider({
    baseUrl: "https://wikidata.test",
    sparqlUrl: "https://query.wikidata.test/sparql",
    userAgent: "MediaEngineTest/0.0.0",
    ...options,
  });
}

function movieEntity() {
  return {
    id: "Q13417189",
    labels: { en: { value: "Interstellar" } },
    descriptions: { en: { value: "2014 science fiction film directed by Christopher Nolan" } },
    claims: {
      P31: [entityClaim("Q11424")],
      P345: [stringClaim("tt0816692")],
      P577: [timeClaim("+2014-10-26T00:00:00Z")],
      P18: [stringClaim("Interstellar_film_poster.jpg")],
    },
  };
}

function createEntityResponse(entity: ReturnType<typeof movieEntity> | Record<string, unknown>) {
  return {
    entities: {
      [String(entity.id)]: entity,
    },
  };
}

function entityClaim(id: string) {
  return {
    mainsnak: {
      datavalue: {
        value: { id },
      },
    },
  };
}

function stringClaim(value: string) {
  return {
    mainsnak: {
      datavalue: {
        value,
      },
    },
  };
}

function timeClaim(time: string) {
  return {
    mainsnak: {
      datavalue: {
        value: { time },
      },
    },
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
    search?: unknown;
    entities?: unknown;
    sparql?: unknown;
  },
) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      userAgent: new Headers(init?.headers).get("user-agent"),
    });

    if (url.pathname === "/w/api.php" && url.searchParams.get("action") === "wbgetentities") {
      return Response.json(responses.entities ?? { entities: {} });
    }

    if (url.pathname === "/w/api.php") {
      return Response.json(responses.search ?? { search: [] });
    }

    if (url.pathname === "/sparql") {
      return Response.json(responses.sparql ?? { results: { bindings: [] } });
    }

    return new Response("Not found", { status: 404 });
  };
}
