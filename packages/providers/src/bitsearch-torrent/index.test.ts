import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { bitsearchTorrentProvider } from "./index.js";
import { createBitsearchTorrentPayload } from "./test-helpers.js";

test("bitsearchTorrentProvider resolves exact movie and episode queries", async () => {
  const requested: URL[] = [];
  const provider = bitsearchTorrentProvider({
    baseUrl: "https://bitsearch.test",
    fetch: async (input) => {
      const url = new URL(input.toString());
      requested.push(url);

      if (url.searchParams.get("category") === "3") {
        const payload = createBitsearchTorrentPayload("Game of Thrones 2011 S01E10");
        payload.results[0] = {
          ...payload.results[0]!,
          title: "Game of Thrones 2011 S01 E10 720p BluRay x264 MKV",
          category: 3,
        };
        return Response.json(payload);
      }

      return Response.json(createBitsearchTorrentPayload());
    },
  });

  const movie = await provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {});
  const episode = await provider.discoverTorrents(
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 10,
    },
    {},
  );

  assert.equal(movie?.candidates.length, 1);
  assert.deepEqual(episode?.candidates[0]?.episode, { seasonNumber: 1, episodeNumber: 10 });
  assert.equal(requested[0]?.pathname, "/api/v1/search");
  assert.equal(requested[1]?.searchParams.get("q"), "Game of Thrones 2011 S01E10");
});

test("bitsearchTorrentProvider skips unsupported, ambiguous, and filtered queries without I/O", async () => {
  let calls = 0;
  const provider = bitsearchTorrentProvider({
    fetch: async () => {
      calls += 1;
      return Response.json(createBitsearchTorrentPayload());
    },
  });

  const queries = [
    { type: "movie" as const, title: "Dune" },
    { type: "movie" as const, year: 2021 },
    { type: "movie" as const, title: "D", year: 2021 },
    { type: "movie" as const, title: "Dune", year: 1799 },
    { type: "movie" as const, title: "Dune", year: 2021, seasonNumber: 1 },
    { type: "series" as const, title: "Dark", year: 2017, episodeNumber: 1 },
    {
      type: "anime" as const,
      title: "One Piece",
      year: 1999,
      seasonNumber: 1,
      absoluteEpisodeNumber: 1,
    },
    { type: "movie" as const, title: "Dune", year: 2021, providers: ["other"] },
  ];

  for (const query of queries) {
    assert.equal(await provider.discoverTorrents(query, {}), null);
  }
  assert.equal(calls, 0);
});

test("bitsearchTorrentProvider maps HTTP, malformed, oversized, timeout, and caller abort failures", async () => {
  for (const [status, code] of [
    [404, "PROVIDER_ERROR"],
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    const provider = bitsearchTorrentProvider({
      fetch: async () => new Response("error", { status }),
    });
    await assert.rejects(
      () => provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
      (error) => error instanceof ProviderError && error.code === code,
    );
  }

  const malformed = bitsearchTorrentProvider({ fetch: async () => new Response("not-json") });
  await assert.rejects(
    () => malformed.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );

  const oversized = bitsearchTorrentProvider({
    maxResponseBytes: 1_024,
    fetch: async () =>
      Response.json({ ...createBitsearchTorrentPayload(), padding: "x".repeat(2_000) }),
  });
  await assert.rejects(
    () => oversized.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );

  const neverResponds = bitsearchTorrentProvider({
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

test("bitsearchTorrentProvider stops network calls after an exhausted anonymous quota", async () => {
  let calls = 0;
  const provider = bitsearchTorrentProvider({
    fetch: async () => {
      calls += 1;
      return Response.json(createBitsearchTorrentPayload(), {
        headers: {
          "X-RateLimit-Limit": "200",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "2999-01-01T00:00:00.000Z",
        },
      });
    },
  });

  assert.ok(await provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}));
  await assert.rejects(
    () => provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_RATE_LIMITED",
  );
  assert.equal(calls, 1);
});
