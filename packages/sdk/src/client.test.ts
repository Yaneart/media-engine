import assert from "node:assert/strict";
import test from "node:test";
import { MediaEngineApiError, MediaEngineClient } from "./client.js";
import type { MediaEngineFetch } from "./client.js";

// EN: Create a mock fetch that records the requested URL and returns one response.
// RU: Создает mock fetch, который записывает requested URL и возвращает один response.
function createMockFetch(response: Response): {
  fetch: MediaEngineFetch;
  calls: URL[];
} {
  const calls: URL[] = [];

  return {
    calls,
    fetch: async (input) => {
      calls.push(input instanceof URL ? input : new URL(input));

      return response;
    },
  };
}

test("search serializes query params and parses response", async () => {
  const body = {
    query: {
      title: "Interstellar",
      type: "movie",
      ids: {
        imdb: "tt0816692",
      },
    },
    results: [],
    meta: {
      tookMs: 1,
      providers: {
        requested: [],
        successful: [],
        failed: [],
      },
    },
  };
  const mock = createMockFetch(Response.json(body));
  const client = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000/",
    fetch: mock.fetch,
  });

  const result = await client.search({
    title: " Interstellar ",
    type: "movie",
    ids: {
      imdb: "tt0816692",
    },
    limit: 10,
  });

  assert.deepEqual(result, body);
  assert.equal(mock.calls[0]?.pathname, "/media/search");
  assert.equal(mock.calls[0]?.searchParams.get("title"), "Interstellar");
  assert.equal(mock.calls[0]?.searchParams.get("type"), "movie");
  assert.equal(mock.calls[0]?.searchParams.get("ids.imdb"), "tt0816692");
  assert.equal(mock.calls[0]?.searchParams.get("limit"), "10");
});

test("getDetails serializes details query params", async () => {
  const body = {
    query: {
      imdb: "tt0816692",
      type: "movie",
    },
    details: null,
    meta: {
      tookMs: 1,
      providers: {
        requested: [],
        successful: [],
        failed: [],
      },
    },
  };
  const mock = createMockFetch(Response.json(body));
  const client = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000",
    fetch: mock.fetch,
  });

  const result = await client.getDetails({
    imdb: "tt0816692",
    type: "movie",
  });

  assert.deepEqual(result, body);
  assert.equal(mock.calls[0]?.pathname, "/media/details");
  assert.equal(mock.calls[0]?.searchParams.get("imdb"), "tt0816692");
  assert.equal(mock.calls[0]?.searchParams.get("type"), "movie");
});

test("getProviders and getHealth parse typed responses", async () => {
  const providersMock = createMockFetch(Response.json([]));
  const providersClient = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000",
    fetch: providersMock.fetch,
  });

  assert.deepEqual(await providersClient.getProviders(), []);
  assert.equal(providersMock.calls[0]?.pathname, "/providers");

  const health = {
    status: "ok",
    service: "media-engine-api",
  } as const;
  const healthMock = createMockFetch(Response.json(health));
  const healthClient = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000",
    fetch: healthMock.fetch,
  });

  assert.deepEqual(await healthClient.getHealth(), health);
  assert.equal(healthMock.calls[0]?.pathname, "/health");
});

test("failed API responses throw typed SDK errors", async () => {
  const mock = createMockFetch(
    Response.json(
      {
        statusCode: 400,
        message: "Invalid search query.",
        error: "Bad Request",
      },
      {
        status: 400,
      },
    ),
  );
  const client = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000",
    fetch: mock.fetch,
  });

  await assert.rejects(
    client.search({}),
    (error: unknown) =>
      error instanceof MediaEngineApiError &&
      error.status === 400 &&
      error.message === "Invalid search query.",
  );
});

test("invalid JSON responses throw typed SDK errors", async () => {
  const mock = createMockFetch(
    new Response("not-json", {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }),
  );
  const client = new MediaEngineClient({
    baseUrl: "http://127.0.0.1:3000",
    fetch: mock.fetch,
  });

  await assert.rejects(
    client.getHealth(),
    (error: unknown) =>
      error instanceof MediaEngineApiError &&
      error.status === 200 &&
      error.message === "Media Engine API returned invalid JSON.",
  );
});
