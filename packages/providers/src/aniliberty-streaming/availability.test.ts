import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { aniLibertyStreamingProvider } from "./index.js";

const BASE_URL = "https://aniliberty.test";

test("aniLibertyStreamingProvider resolves one exact anime episode into direct HLS", async () => {
  const requestedUrls: string[] = [];
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url.href);
      return url.pathname.endsWith("/app/search/releases")
        ? Response.json([createReleaseSummary()])
        : Response.json(createRelease());
    },
  });

  const result = await provider.getAvailability(
    { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 1 },
    {},
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[0]!).pathname, "/api/v1/app/search/releases");
  assert.equal(new URL(requestedUrls[0]!).searchParams.get("query"), "One Piece");
  assert.equal(new URL(requestedUrls[1]!).pathname, "/api/v1/anime/releases/10290");
  assert.equal(result?.item?.title, "One Piece");
  assert.equal(result?.item?.originalTitle, undefined);
  assert.deepEqual(
    result?.options.map((option) => option.quality?.height),
    [1080, 720, 480],
  );
  assert.deepEqual(result?.sourceProviders, [
    {
      provider: "aniliberty-streaming",
      url: "https://aniliberty.test/api/v1/anime/releases/10290",
    },
  ]);
});

test("aniLibertyStreamingProvider avoids unsupported or underidentified queries", async () => {
  let calls = 0;
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      calls += 1;
      return Response.json([]);
    },
  });

  for (const query of [
    { type: "series" as const, title: "One Piece", year: 1999 },
    { type: "anime" as const, title: "One Piece" },
    { type: "anime" as const, title: "One Piece", year: 1999, seasonNumber: 1 },
    { type: "anime" as const, title: "One Piece", year: 1999, episodeNumber: 1 },
    {
      type: "anime" as const,
      title: "One Piece",
      year: 1999,
      providers: ["other-provider"],
    },
  ]) {
    assert.equal(await provider.getAvailability(query, {}), null);
  }

  assert.equal(calls, 0);
});

test("aniLibertyStreamingProvider rejects ambiguous search matches before release loading", async () => {
  let calls = 0;
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      calls += 1;
      return Response.json([createReleaseSummary(), { ...createReleaseSummary(), id: 50000 }]);
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "anime", title: "One Piece", year: 1999 }, {}),
    null,
  );
  assert.equal(calls, 1);
});

test("aniLibertyStreamingProvider treats a disappeared selected release as no result", async () => {
  let calls = 0;
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? Response.json([createReleaseSummary()])
        : new Response("Not found", { status: 404 });
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "anime", title: "One Piece", year: 1999 }, {}),
    null,
  );
  assert.equal(calls, 2);
});

test("aniLibertyStreamingProvider revalidates the selected release ID", async () => {
  let calls = 0;
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? Response.json([createReleaseSummary()])
        : Response.json({ ...createRelease(), id: 50000 });
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "anime", title: "One Piece", year: 1999 }, {}),
    null,
  );
  assert.equal(calls, 2);
});

test("aniLibertyStreamingProvider preserves caller cancellation", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  const result = provider.getAvailability(
    { type: "anime", title: "One Piece", year: 1999 },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);

  await assert.rejects(result, (error) => error === cancellation);
});

test("aniLibertyStreamingProvider reports invalid upstream schema as typed failure", async () => {
  const provider = aniLibertyStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => Response.json({ data: [] }),
  });

  await assert.rejects(
    provider.getAvailability({ type: "anime", title: "One Piece", year: 1999 }, {}),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

function createReleaseSummary() {
  return {
    id: 10290,
    year: 1999,
    name: { main: "Ван-Пис", english: "One Piece", alternative: null },
    alias: "one-piece",
    is_blocked_by_geo: false,
    is_blocked_by_copyrights: false,
  };
}

function createRelease() {
  return {
    ...createReleaseSummary(),
    episodes: [
      {
        id: "episode-1",
        name: "Episode 1",
        ordinal: 1,
        hls_480: "https://cdn.test/1/480.m3u8",
        hls_720: "https://cdn.test/1/720.m3u8",
        hls_1080: "https://cdn.test/1/1080.m3u8",
      },
    ],
  };
}
