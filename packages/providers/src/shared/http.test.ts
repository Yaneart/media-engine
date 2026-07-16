import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { fetchJson, mapHttpStatusToProviderErrorCode, normalizePublicHttpUrl } from "./http.js";

test("normalizePublicHttpUrl rejects local and private network targets", () => {
  for (const value of [
    "http://localhost/admin",
    "http://service.localhost/admin",
    "http://127.0.0.1/admin",
    "http://10.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://172.16.0.1/admin",
    "http://192.168.0.1/admin",
    "http://[::1]/admin",
    "http://[fd00::1]/admin",
    "https://user:password@player.test/embed",
  ]) {
    assert.equal(normalizePublicHttpUrl(value), undefined, value);
  }
});

test("normalizePublicHttpUrl preserves public HTTP targets", () => {
  assert.equal(
    normalizePublicHttpUrl("https://player.test/embed?id=1"),
    "https://player.test/embed?id=1",
  );
});

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

test("fetchJson retries retryable provider failures", async () => {
  let calls = 0;

  const result = await fetchJson<{ ok: true }>({
    provider: "test-provider",
    url: "https://example.test/movie",
    maxRetries: 1,
    retryDelayMs: 0,
    fetch: async () => {
      calls += 1;

      return calls === 1
        ? new Response("temporarily unavailable", { status: 503 })
        : Response.json({ ok: true });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
});

test("fetchJson does not retry non-retryable provider failures", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        maxRetries: 2,
        retryDelayMs: 0,
        fetch: async () => {
          calls += 1;

          return new Response("not found", { status: 404 });
        },
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_ERROR",
      retryable: false,
    },
  );

  assert.equal(calls, 1);
});

test("fetchJson returns the last retryable provider failure after retries", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchJson({
        provider: "test-provider",
        url: "https://example.test/movie",
        maxRetries: 2,
        retryDelayMs: 0,
        fetch: async () => {
          calls += 1;

          return new Response("rate limited", { status: 429 });
        },
      }),
    {
      name: "ProviderError",
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
    },
  );

  assert.equal(calls, 3);
});

test("fetchJson respects Retry-After within the bounded retry delay", async () => {
  let calls = 0;
  const startedAt = Date.now();

  const result = await fetchJson<{ ok: true }>({
    provider: "test-provider",
    url: "https://example.test/movie",
    maxRetries: 1,
    retryDelayMs: 0,
    maxRetryDelayMs: 15,
    retryJitterRatio: 0,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "1" },
          })
        : Response.json({ ok: true });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
  assert.ok(Date.now() - startedAt >= 10);
  assert.ok(Date.now() - startedAt < 200);
});

test("fetchJson stops retry backoff when the provider call is aborted", async () => {
  const controller = new AbortController();
  const timeoutError = new ProviderError({
    provider: "test-provider",
    code: "PROVIDER_TIMEOUT",
    message: "Provider timed out.",
    retryable: true,
  });
  let calls = 0;

  const request = fetchJson({
    provider: "test-provider",
    url: "https://example.test/movie",
    context: { signal: controller.signal },
    maxRetries: 2,
    retryDelayMs: 1_000,
    fetch: async () => {
      calls += 1;
      return new Response("temporarily unavailable", { status: 503 });
    },
  });

  setTimeout(() => controller.abort(timeoutError), 10);

  await assert.rejects(request, { code: "PROVIDER_TIMEOUT" });
  assert.equal(calls, 1);
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

test("fetchJson keeps retries inside one total timeout budget", async () => {
  let attempts = 0;
  const startedAt = Date.now();

  await assert.rejects(
    fetchJson({
      provider: "slow-retry",
      url: "https://provider.test/data",
      context: { timeoutMs: 25 },
      maxRetries: 3,
      retryDelayMs: 20,
      fetch: async (_input, init) => {
        attempts += 1;

        if (attempts === 1) {
          return new Response("unavailable", { status: 503 });
        }

        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    }),
    (error: unknown) => error instanceof ProviderError && error.code === "PROVIDER_TIMEOUT",
  );

  assert.equal(attempts, 2);
  assert.ok(Date.now() - startedAt < 100);
});

test("mapHttpStatusToProviderErrorCode maps important provider statuses", () => {
  assert.equal(mapHttpStatusToProviderErrorCode(401), "PROVIDER_UNAUTHORIZED");
  assert.equal(mapHttpStatusToProviderErrorCode(403), "PROVIDER_UNAUTHORIZED");
  assert.equal(mapHttpStatusToProviderErrorCode(429), "PROVIDER_RATE_LIMITED");
  assert.equal(mapHttpStatusToProviderErrorCode(500), "PROVIDER_UNAVAILABLE");
  assert.equal(mapHttpStatusToProviderErrorCode(404), "PROVIDER_ERROR");
});
