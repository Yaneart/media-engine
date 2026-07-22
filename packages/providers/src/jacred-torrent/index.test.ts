import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { jacRedTorrentProvider } from "./index.js";
import { createJacRedTorrentPayload } from "./test-helpers.js";

test("jacRedTorrentProvider resolves exact title/year movie and season queries", async () => {
  const requested: URL[] = [];
  const provider = jacRedTorrentProvider({
    baseUrl: "https://api.jacred.test",
    fetch: async (input) => {
      requested.push(new URL(input.toString()));
      return Response.json(createJacRedTorrentPayload());
    },
  });

  const movie = await provider.discoverTorrents({ type: "movie", title: "Дюна", year: 2021 }, {});
  const missingSeason = await provider.discoverTorrents(
    { type: "series", title: "Дюна", year: 2021, seasonNumber: 1 },
    {},
  );

  assert.equal(movie?.candidates.length, 1);
  assert.equal(missingSeason, null);
  assert.equal(requested[0]?.pathname, "/api/search");
  assert.equal(requested[0]?.searchParams.get("category"), "movie");
  assert.equal(requested[1]?.searchParams.get("season"), "1");
});

test("jacRedTorrentProvider skips unsupported, ambiguous, and filtered queries without I/O", async () => {
  let calls = 0;
  const provider = jacRedTorrentProvider({
    fetch: async () => {
      calls += 1;
      return Response.json(createJacRedTorrentPayload());
    },
  });

  const queries = [
    { type: "movie" as const, title: "Dune" },
    { type: "movie" as const, year: 2021 },
    { type: "movie" as const, title: "D", year: 2021 },
    { type: "movie" as const, title: "Dune", year: 1799 },
    { type: "movie" as const, title: "Dune", year: 2021, seasonNumber: 1 },
    { type: "series" as const, title: "Dark", year: 2017, episodeNumber: 1 },
    { type: "anime" as const, title: "One Piece", year: 1999, absoluteEpisodeNumber: 1 },
    { type: "movie" as const, title: "Dune", year: 2021, providers: ["other"] },
  ];

  for (const query of queries) {
    assert.equal(await provider.discoverTorrents(query, {}), null);
  }
  assert.equal(calls, 0);
});

test("jacRedTorrentProvider maps HTTP, malformed, oversized, timeout, and caller abort failures", async () => {
  for (const [status, code] of [
    [404, "PROVIDER_ERROR"],
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    const provider = jacRedTorrentProvider({
      fetch: async () => new Response("error", { status }),
    });
    await assert.rejects(
      () => provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
      (error) => error instanceof ProviderError && error.code === code,
    );
  }

  const malformed = jacRedTorrentProvider({ fetch: async () => new Response("not-json") });
  await assert.rejects(
    () => malformed.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );

  const oversized = jacRedTorrentProvider({
    maxResponseBytes: 1_024,
    fetch: async () =>
      Response.json({ ...createJacRedTorrentPayload(), padding: "x".repeat(2_000) }),
  });
  await assert.rejects(
    () => oversized.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );

  const neverResponds = jacRedTorrentProvider({
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
        { type: "movie", title: "Dune", year: 2021 },
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
        { type: "movie", title: "Dune", year: 2021 },
        { signal: controller.signal },
      ),
    (error) => error === cancellation,
  );
});
