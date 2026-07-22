import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { ytsTorrentProvider } from "./index.js";
import { createYtsTorrentPayload } from "./test-helpers.js";

test("ytsTorrentProvider resolves exact IMDb and title/year movie queries", async () => {
  const requested: URL[] = [];
  const provider = ytsTorrentProvider({
    baseUrl: "https://movies-api.test",
    fetch: async (input) => {
      requested.push(new URL(input.toString()));
      return Response.json(createYtsTorrentPayload());
    },
  });

  const byImdb = await provider.discoverTorrents({ type: "movie", ids: { imdb: "tt1375666" } }, {});
  const byTitle = await provider.discoverTorrents(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.equal(byImdb?.candidates.length, 1);
  assert.equal(byTitle?.item?.ids?.imdb, "tt1375666");
  assert.equal(requested[0]?.searchParams.get("query_term"), "tt1375666");
  assert.equal(requested[1]?.searchParams.get("query_term"), "Inception");
});

test("ytsTorrentProvider skips unsupported, ambiguous, and filtered queries without I/O", async () => {
  let calls = 0;
  const provider = ytsTorrentProvider({
    fetch: async () => {
      calls += 1;
      return Response.json(createYtsTorrentPayload());
    },
  });

  const queries = [
    { type: "series" as const, title: "Inception", year: 2010 },
    { type: "movie" as const, title: "Inception" },
    { type: "movie" as const, title: "Inception", year: 2010, episodeNumber: 1 },
    { type: "movie" as const, ids: { imdb: "tt1375666" }, providers: ["other"] },
  ];

  for (const query of queries) {
    assert.equal(await provider.discoverTorrents(query, {}), null);
  }
  assert.equal(calls, 0);
});

test("ytsTorrentProvider maps HTTP, malformed, oversized, timeout, and caller abort failures", async () => {
  for (const [status, code] of [
    [404, "PROVIDER_ERROR"],
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    const provider = ytsTorrentProvider({ fetch: async () => new Response("error", { status }) });
    await assert.rejects(
      () => provider.discoverTorrents({ type: "movie", ids: { imdb: "tt1375666" } }, {}),
      (error) => error instanceof ProviderError && error.code === code,
    );
  }

  const malformed = ytsTorrentProvider({ fetch: async () => new Response("not-json") });
  await assert.rejects(
    () => malformed.discoverTorrents({ type: "movie", ids: { imdb: "tt1375666" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );

  const oversized = ytsTorrentProvider({
    maxResponseBytes: 1_024,
    fetch: async () => Response.json({ ...createYtsTorrentPayload(), padding: "x".repeat(2_000) }),
  });
  await assert.rejects(
    () => oversized.discoverTorrents({ type: "movie", ids: { imdb: "tt1375666" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );

  const neverResponds = ytsTorrentProvider({
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });
  await assert.rejects(
    () =>
      neverResponds.discoverTorrents(
        { type: "movie", ids: { imdb: "tt1375666" } },
        { timeoutMs: 5 },
      ),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_TIMEOUT",
  );

  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  controller.abort(cancellation);
  await assert.rejects(
    () =>
      neverResponds.discoverTorrents(
        { type: "movie", ids: { imdb: "tt1375666" } },
        { signal: controller.signal },
      ),
    (error) => error === cancellation,
  );
});
