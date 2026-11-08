import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { veoVeoStreamingProvider } from "./index.js";

test("veoVeoStreamingProvider resolves direct VeoVeo identity into one exact direct HLS episode", async () => {
  const requestedUrls: URL[] = [];
  let manifestAttempts = 0;
  const provider = veoVeoStreamingProvider({
    apiKey: "never-forward",
    lookupBaseUrl: "https://lookup.test",
    streamBaseUrl: "https://veo.test",
    now: () => Date.parse("2026-08-22T12:00:00.000Z"),
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);
      if (url.hostname === "lookup.test") {
        return new Response("window.MOVIE_ID=31869;");
      }
      if (url.pathname.includes("/contents/"))
        return Response.json({ id: 31869, kinopoiskId: 4541515 });
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

  assert.equal(requestedUrls.length, 5);
  assert.equal(requestedUrls[0]?.searchParams.get("kp"), "4541515");
  assert.equal(requestedUrls[2]?.searchParams.get("content-id"), "31869");
  assert.equal(requestedUrls[1]?.href.includes("never-forward"), false);
  assert.equal(requestedUrls[4]?.hostname, "cdn.test");
  assert.equal(requestedUrls[3]?.hostname, "cdn.test");
  assert.equal(JSON.stringify(result).includes("never-forward"), false);
  assert.equal(requestedUrls[0]?.searchParams.get("token"), "never-forward");
  assert.equal(
    requestedUrls.slice(1).some((url) => url.searchParams.has("token")),
    false,
  );
  assert.equal(
    requestedUrls.some((url) => /ddbb/.test(url.hostname)),
    false,
  );
  assert.equal(result?.options[0]?.access.url, "https://edge.test/s03e01/master.m3u8?sig=resolved");
  assert.equal(result?.options[0]?.expiresAt, "2026-08-22T12:05:00.000Z");
});

test("veoVeoStreamingProvider resolves a confirmed anime movie as direct HLS", async () => {
  const provider = veoVeoStreamingProvider({
    apiKey: "never-forward",
    lookupBaseUrl: "https://lookup.test",
    streamBaseUrl: "https://veo.test",
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "lookup.test") {
        return new Response("window.MOVIE_ID=370;");
      }
      if (url.pathname.includes("/contents/")) return Response.json({ id: 370, kinopoiskId: 370 });
      if (url.hostname === "cdn.test") {
        return new Response("#EXTM3U\n#EXT-X-ENDLIST", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      return Response.json([
        {
          order: 0,
          season: { order: 0 },
          episodeVariants: [{ title: "1080p", filepath: "https://cdn.test/movie.m3u8" }],
        },
      ]);
    },
  });

  const result = await provider.getAvailability(
    { type: "anime", animeKind: "movie", ids: { kinopoisk: "370" } },
    {},
  );

  assert.equal(result?.item?.type, "anime");
  assert.equal(result?.options[0]?.player.kind, "hls");
  assert.equal(result?.episodes, undefined);
});

test("veoVeoStreamingProvider resolves one explicitly mapped anime episode", async () => {
  const requestedManifests: string[] = [];
  const provider = veoVeoStreamingProvider({
    apiKey: "never-forward",
    lookupBaseUrl: "https://lookup.test",
    streamBaseUrl: "https://veo.test",
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "lookup.test") {
        return new Response("window.MOVIE_ID=96592;");
      }
      if (url.pathname.includes("/contents/"))
        return Response.json({ id: 96592, kinopoiskId: 5401195 });
      if (url.hostname === "cdn.test") {
        requestedManifests.push(url.pathname);
        return new Response("#EXTM3U\n#EXT-X-ENDLIST", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      return Response.json([
        {
          order: 1,
          season: { order: 1 },
          episodeVariants: [{ filepath: "https://cdn.test/s01e01/master.m3u8" }],
        },
        {
          order: 1,
          season: { order: 2 },
          episodeVariants: [{ filepath: "https://cdn.test/s02e01/master.m3u8" }],
        },
      ]);
    },
  });

  const result = await provider.getAvailability(
    {
      type: "anime",
      animeKind: "tv",
      ids: { aniList: "170000", kinopoisk: "5401195" },
      seasonNumber: 1,
      episodeNumber: 2,
      absoluteEpisodeNumber: 2,
      animeReleaseEpisode: {
        releaseIndex: 1,
        releaseEpisodeNumber: 1,
        releaseEpisodeCounts: [1, 1],
      },
    },
    {},
  );

  assert.deepEqual(requestedManifests, ["/s02e01/master.m3u8"]);
  assert.equal(result?.item?.type, "anime");
  assert.deepEqual(result?.options[0]?.episode, {
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteEpisodeNumber: 2,
  });

  assert.equal(
    await provider.getAvailability(
      {
        type: "anime",
        animeKind: "tv",
        ids: { aniList: "170000", kinopoisk: "5401195" },
        seasonNumber: 2,
        episodeNumber: 1,
        absoluteEpisodeNumber: 1,
        animeReleaseEpisode: {
          releaseIndex: 1,
          releaseEpisodeNumber: 1,
          releaseEpisodeCounts: [1, 1],
        },
      },
      {},
    ),
    null,
  );
  assert.deepEqual(requestedManifests, ["/s02e01/master.m3u8"]);
});

test("veoVeoStreamingProvider avoids unsupported and underidentified queries", async () => {
  let calls = 0;
  const provider = veoVeoStreamingProvider({
    apiKey: "never-forward",
    fetch: async () => {
      calls += 1;
      return Response.json({ data: [] });
    },
  });

  for (const query of [
    { type: "movie" as const, title: "Movie" },
    { type: "anime" as const, ids: { kinopoisk: "1" } },
    {
      type: "anime" as const,
      animeKind: "tv" as const,
      ids: { aniList: "154587", kinopoisk: "5401195" },
      absoluteEpisodeNumber: 1,
    },
    {
      type: "anime" as const,
      animeKind: "tv" as const,
      ids: { kinopoisk: "5401195" },
      seasonNumber: 1,
      episodeNumber: 1,
      absoluteEpisodeNumber: 1,
    },
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
    apiKey: "never-forward",
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
    apiKey: "never-forward",
    fetch: async () => new Response("window.MOVIE_ID=-1;"),
  });
  await assert.rejects(
    invalidProvider.getAvailability({ type: "movie", ids: { kinopoisk: "258687" } }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});
