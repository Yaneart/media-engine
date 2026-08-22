import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { veoVeoStreamingProvider } from "./index.js";

test("veoVeoStreamingProvider resolves DDBB identity into one exact direct HLS episode", async () => {
  const requestedUrls: URL[] = [];
  let manifestAttempts = 0;
  const provider = veoVeoStreamingProvider({
    lookupBaseUrl: "https://lookup.test",
    streamBaseUrl: "https://veo.test",
    now: () => Date.parse("2026-08-22T12:00:00.000Z"),
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);
      if (url.hostname === "lookup.test") {
        return Response.json({
          data: [
            {
              type: "VeoVeo",
              iframeUrl: "https://iframe.test/player?movie_id=31869&token=never-forward",
              translations: [],
            },
          ],
        });
      }
      if (url.hostname === "cdn.test") {
        manifestAttempts += 1;
        if (manifestAttempts === 1) return new Response(null, { status: 503 });
        const response = new Response("#EXTM3U\n#EXT-X-ENDLIST", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
        Object.defineProperty(response, "url", {
          value: "https://edge.test/s03e01/master.m3u8?sig=resolved",
        });
        return response;
      }
      return Response.json([
        {
          order: 1,
          title: "Episode 1",
          season: { order: 3 },
          episodeVariants: [
            { title: "720p", filepath: "https://cdn.test/s03e01/master.m3u8?sig=signed" },
          ],
        },
      ]);
    },
  });

  const result = await provider.getAvailability(
    {
      type: "series",
      title: "Silo",
      ids: { kinopoisk: "4541515" },
      seasonNumber: 3,
      episodeNumber: 1,
    },
    {},
  );

  assert.equal(requestedUrls.length, 4);
  assert.equal(requestedUrls[0]?.searchParams.get("kinopoisk"), "4541515");
  assert.equal(requestedUrls[1]?.searchParams.get("content-id"), "31869");
  assert.equal(requestedUrls[1]?.href.includes("never-forward"), false);
  assert.equal(requestedUrls[2]?.hostname, "cdn.test");
  assert.equal(requestedUrls[3]?.hostname, "cdn.test");
  assert.equal(JSON.stringify(result).includes("never-forward"), false);
  assert.equal(result?.options[0]?.access.url, "https://edge.test/s03e01/master.m3u8?sig=resolved");
  assert.equal(result?.options[0]?.expiresAt, "2026-08-22T12:05:00.000Z");
});

test("veoVeoStreamingProvider avoids unsupported and underidentified queries", async () => {
  let calls = 0;
  const provider = veoVeoStreamingProvider({
    fetch: async () => {
      calls += 1;
      return Response.json({ data: [] });
    },
  });

  for (const query of [
    { type: "movie" as const, title: "Movie" },
    { type: "anime" as const, ids: { kinopoisk: "1" } },
    { type: "series" as const, ids: { kinopoisk: "1" }, episodeNumber: 1 },
    { type: "series" as const, ids: { kinopoisk: "1" }, absoluteEpisodeNumber: 1 },
    { type: "movie" as const, ids: { kinopoisk: "1" }, providers: ["other"] },
  ]) {
    assert.equal(await provider.getAvailability(query, {}), null);
  }
  assert.equal(calls, 0);
});

test("veoVeoStreamingProvider preserves cancellation and typed schema failures", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const cancellingProvider = veoVeoStreamingProvider({
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  });
  const pending = cancellingProvider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);
  await assert.rejects(pending, (error) => error === cancellation);

  const invalidProvider = veoVeoStreamingProvider({
    fetch: async () => Response.json([]),
  });
  await assert.rejects(
    invalidProvider.getAvailability({ type: "movie", ids: { kinopoisk: "258687" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});
