import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockProvider, MediaEngine, MemoryCache } from "@media-engine/core";

import { cinemetaProvider } from "./index.js";

test("cinemetaProvider returns null only after both untyped IMDb branches confirm absence", async () => {
  const provider = createProvider({
    "/meta/movie/tt-missing.json": () => new Response("not found", { status: 404 }),
    "/meta/series/tt-missing.json": () => new Response("not found", { status: 404 }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt-missing" } }, {});

  assert.equal(result, null);
});

test("cinemetaProvider returns available untyped IMDb details despite the other branch outage", async () => {
  const provider = createProvider({
    "/meta/movie/tt0816692.json": () =>
      Response.json({
        meta: {
          id: "tt0816692",
          imdb_id: "tt0816692",
          type: "movie",
          name: "Interstellar",
          releaseInfo: "2014",
        },
      }),
    "/meta/series/tt0816692.json": () => new Response("unavailable", { status: 503 }),
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0816692" } }, {});

  assert.equal(result?.details.title, "Interstellar");
  assert.equal(result?.details.type, "movie");
});

test("cinemetaProvider propagates a retryable outage after the other branch confirms absence", async () => {
  const provider = createProvider({
    "/meta/movie/tt-outage.json": () => new Response("not found", { status: 404 }),
    "/meta/series/tt-outage.json": () => new Response("unavailable", { status: 503 }),
  });

  await assert.rejects(() => provider.getDetails!({ ids: { imdb: "tt-outage" } }, {}), {
    name: "ProviderError",
    provider: "cinemeta",
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
  });
});

test("cinemetaProvider propagates a retryable outage when both untyped branches fail", async () => {
  const provider = createProvider({
    "/meta/movie/tt-outage.json": () => new Response("unavailable", { status: 503 }),
    "/meta/series/tt-outage.json": () => new Response("unavailable", { status: 503 }),
  });

  await assert.rejects(() => provider.getDetails!({ ids: { imdb: "tt-outage" } }, {}), {
    name: "ProviderError",
    provider: "cinemeta",
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
  });
});

test("Cinemeta retryable details degradation is not cached as a complete engine response", async () => {
  let stableCalls = 0;
  let movieCalls = 0;
  const cinemeta = cinemetaProvider({
    baseUrl: "https://cinemeta.test",
    fetch: createRouteFetch({
      "/meta/movie/tt0816692.json": () => {
        movieCalls += 1;

        return movieCalls <= 2
          ? new Response("unavailable", { status: 503 })
          : Response.json({
              meta: {
                id: "tt0816692",
                imdb_id: "tt0816692",
                type: "movie",
                name: "Interstellar",
                releaseInfo: "2014",
                description: "Recovered Cinemeta description.",
              },
            });
      },
      "/meta/series/tt0816692.json": () => new Response("not found", { status: 404 }),
    }),
  });
  const stable = createMockProvider({
    name: "stable-provider",
    capabilities: { details: { byExternalIds: ["imdb"] } },
    getDetails() {
      stableCalls += 1;
      return {
        provider: "stable-provider",
        details: {
          id: "stable-interstellar",
          type: "movie",
          title: "Interstellar",
          year: 2014,
          ids: { imdb: "tt0816692" },
        },
      };
    },
  });
  const engine = new MediaEngine({ cache: new MemoryCache(), providers: [stable, cinemeta] });

  const first = await engine.getDetails({ imdb: "tt0816692" });
  const second = await engine.getDetails({ imdb: "tt0816692" });
  const third = await engine.getDetails({ imdb: "tt0816692" });

  assert.equal(first.meta.cached, false);
  assert.equal(first.meta.providers.failed[0]?.code, "PROVIDER_UNAVAILABLE");
  assert.equal(second.meta.cached, false);
  assert.equal(second.meta.providers.failed.length, 0);
  assert.equal(second.details?.description, "Recovered Cinemeta description.");
  assert.equal(third.meta.cached, true);
  assert.equal(stableCalls, 2);
  assert.equal(movieCalls, 3);
});

type RouteFactory = () => Response;

function createProvider(routes: Record<string, RouteFactory>) {
  return cinemetaProvider({
    baseUrl: "https://cinemeta.test",
    fetch: createRouteFetch(routes),
  });
}

function createRouteFetch(routes: Record<string, RouteFactory>) {
  return async (input: string | URL): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    return routes[path]?.() ?? new Response("not found", { status: 404 });
  };
}
