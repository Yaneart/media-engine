import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { magnetzTorrentProvider } from "./index.js";
import { createMagnetzTorrentPayload } from "./test-helpers.js";

test("magnetzTorrentProvider resolves exact movie and episode queries through search only", async () => {
  const requested: URL[] = [];
  const provider = magnetzTorrentProvider({
    baseUrl: "https://magnetz.test",
    requestIntervalMs: 0,
    fetch: async (input) => {
      const url = new URL(input.toString());
      requested.push(url);
      const query = url.searchParams.get("query")!;
      const payload = createMagnetzTorrentPayload(query);

      if (query.includes("S01E10")) {
        payload.data[0] = {
          ...payload.data[0]!,
          name: "Game of Thrones 2011 S01E10 1080p BluRay x264 MKV",
        };
      }

      return Response.json(payload);
    },
  });

  const movie = await provider.discoverTorrents(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );
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
  assert.deepEqual(
    requested.map((url) => url.pathname),
    ["/api/magnets/search", "/api/magnets/search"],
  );
});

test("magnetzTorrentProvider skips unsupported, ambiguous, and filtered queries without I/O", async () => {
  let calls = 0;
  const provider = magnetzTorrentProvider({
    requestIntervalMs: 0,
    fetch: async () => {
      calls += 1;
      return Response.json(createMagnetzTorrentPayload());
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

test("magnetzTorrentProvider maps HTTP, malformed, oversized, timeout, and caller abort failures", async () => {
  for (const [status, code] of [
    [404, "PROVIDER_ERROR"],
    [429, "PROVIDER_RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    const provider = magnetzTorrentProvider({
      requestIntervalMs: 0,
      fetch: async () => new Response("error", { status }),
    });
    await assert.rejects(
      () => provider.discoverTorrents({ type: "movie", title: "Inception", year: 2010 }, {}),
      (error) => error instanceof ProviderError && error.code === code,
    );
  }

  const malformed = magnetzTorrentProvider({
    requestIntervalMs: 0,
    fetch: async () => new Response("not-json"),
  });
  await assert.rejects(
    () => malformed.discoverTorrents({ type: "movie", title: "Inception", year: 2010 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );

  const oversized = magnetzTorrentProvider({
    requestIntervalMs: 0,
    maxResponseBytes: 1_024,
    fetch: async () =>
      Response.json({ ...createMagnetzTorrentPayload(), padding: "x".repeat(2_000) }),
  });
  await assert.rejects(
    () => oversized.discoverTorrents({ type: "movie", title: "Inception", year: 2010 }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );

  const neverResponds = magnetzTorrentProvider({
    requestIntervalMs: 0,
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
        { type: "movie", title: "Inception", year: 2010 },
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
        { type: "movie", title: "Inception", year: 2010 },
        { signal: controller.signal },
      ),
    (error) => error === cancellation,
  );
});

test("magnetzTorrentProvider spaces concurrent request starts", async () => {
  const starts: number[] = [];
  const provider = magnetzTorrentProvider({
    baseUrl: "https://magnetz.test",
    requestIntervalMs: 20,
    fetch: async (input) => {
      starts.push(Date.now());
      const query = new URL(input.toString()).searchParams.get("query")!;
      return Response.json(createMagnetzTorrentPayload(query));
    },
  });

  await Promise.all([
    provider.discoverTorrents({ type: "movie", title: "Inception", year: 2010 }, {}),
    provider.discoverTorrents({ type: "movie", title: "Dune", year: 2021 }, {}),
  ]);

  assert.equal(starts.length, 2);
  assert.ok(starts[1]! - starts[0]! >= 15);
});
