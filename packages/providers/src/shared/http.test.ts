import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { fetchJson, mapHttpStatusToProviderErrorCode } from "./http.js";

test("fetchJson parses successful JSON responses", async () => {
  const result = await fetchJson<{ title: string }>({
    provider: "test-provider",
    url: "https://example.test/movie",
    fetch: async () => Response.json({ title: "Interstellar" }),
  });

  assert.deepEqual(result, { title: "Interstellar" });
});

test("fetchJson maps invalid JSON to provider invalid response", async () => {
  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        fetch: async () =>
          new Response("not-json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: false,
    },
  );
});

test("fetchJson maps HTTP status failures to provider errors", async () => {
  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        fetch: async () => new Response("rate limited", { status: 429 }),
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
    },
  );
});

test("fetchJson maps network failures to provider unavailable", async () => {
  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        fetch: async () => {
          throw new Error("Network failed.");
        },
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      message: "Network failed.",
    },
  );
});

test("fetchJson applies timeout to fetch implementations", async () => {
  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        context: { timeoutMs: 0 },
        fetch: async (_url, init) => {
          if (init?.signal?.aborted) {
            throw init.signal.reason;
          }

          return Response.json({});
        },
      }),
    (error) => {
      assert.equal(error instanceof ProviderError, true);
      assert.equal((error as ProviderError).code, "PROVIDER_TIMEOUT");
      assert.equal((error as ProviderError).retryable, true);
      return true;
    },
  );
});

test("mapHttpStatusToProviderErrorCode maps important provider statuses", () => {
  assert.equal(mapHttpStatusToProviderErrorCode(401), "PROVIDER_UNAUTHORIZED");
  assert.equal(mapHttpStatusToProviderErrorCode(403), "PROVIDER_UNAUTHORIZED");
  assert.equal(mapHttpStatusToProviderErrorCode(429), "PROVIDER_RATE_LIMITED");
  assert.equal(mapHttpStatusToProviderErrorCode(500), "PROVIDER_UNAVAILABLE");
  assert.equal(mapHttpStatusToProviderErrorCode(404), "PROVIDER_ERROR");
});
