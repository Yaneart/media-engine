import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { fetchFlixHqText } from "./client.js";

const BASE_URL = "https://flixhq.test";

test("FlixHQ navigation follows bounded same-origin relative redirects", async () => {
  const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
  const fetch: ProviderFetch = async (input, init) => {
    const url = new URL(input.toString());
    requests.push({ url: url.href, redirect: init?.redirect });
    return url.pathname === "/start"
      ? new Response(null, { status: 302, headers: { location: "/final" } })
      : new Response("working");
  };

  const result = await fetchFlixHqText(createConfig(fetch), new URL("/start", BASE_URL), {});

  assert.equal(result, "working");
  assert.deepEqual(requests, [
    { url: `${BASE_URL}/start`, redirect: "manual" },
    { url: `${BASE_URL}/final`, redirect: "manual" },
  ]);
});

test("FlixHQ navigation permits an explicitly configured local self-hosted origin", async () => {
  const localBaseUrl = "http://127.0.0.1:8080";
  const fetch: ProviderFetch = async () => new Response("self-hosted");

  const result = await fetchFlixHqText(
    { ...createConfig(fetch), baseUrl: localBaseUrl },
    new URL("/search", localBaseUrl),
    {},
  );

  assert.equal(result, "self-hosted");
});

test("FlixHQ navigation rejects cross-origin redirects without requesting them", async () => {
  let calls = 0;
  const fetch: ProviderFetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });
  };

  await assert.rejects(
    () => fetchFlixHqText(createConfig(fetch), new URL("/start", BASE_URL), {}),
    { code: "PROVIDER_INVALID_RESPONSE", retryable: false },
  );
  assert.equal(calls, 1);
});

test("FlixHQ navigation rejects redirect loops", async () => {
  let calls = 0;
  const fetch: ProviderFetch = async (input) => {
    calls += 1;
    const url = new URL(input.toString());
    return new Response(null, {
      status: 302,
      headers: { location: url.pathname === "/one" ? "/two" : "/one" },
    });
  };

  await assert.rejects(() => fetchFlixHqText(createConfig(fetch), new URL("/one", BASE_URL), {}), {
    code: "PROVIDER_INVALID_RESPONSE",
  });
  assert.equal(calls, 2);
});

function createConfig(fetch: ProviderFetch) {
  return {
    baseUrl: BASE_URL,
    name: "flixhq-streaming",
    fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    maxHtmlBytes: 1024,
    userAgent: "MediaEngineTest/0.1",
  };
}
