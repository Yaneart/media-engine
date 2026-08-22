import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, type ProviderContext } from "@media-engine/core";
import type { ProviderFetch } from "../shared/index.js";
import { videoHubStreamingProvider } from "./index.js";

test("videoHubStreamingProvider resolves one exact series episode into direct MP4 qualities", async () => {
  const requests: string[] = [];
  const requestUserAgents: string[] = [];
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    now: () => Date.parse("2026-08-22T12:00:00.000Z"),
    fetch: async (input, init) => {
      const url = String(input);
      requests.push(url);
      requestUserAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
      if (url.includes("/playlist?")) {
        return Response.json({
          titleName: "Во все тяжкие",
          isSerial: true,
          items: [
            {
              season: 1,
              episode: 1,
              voiceStudio: "LostFilm",
              voiceType: "Многоголосый",
              vkId: "111",
            },
            { season: 1, episode: 1, voiceType: "Дубляж", vkId: "222" },
            { season: 1, episode: 2, voiceType: "Дубляж", vkId: "333" },
          ],
        });
      }

      const vkId = new URL(url).pathname.split("/").at(-1);
      return Response.json({
        sources: {
          mpegFullHdUrl: `https://cdn.test/${vkId}/1080?sig=one`,
          mpegHighUrl: `https://cdn.test/${vkId}/720?sig=two`,
          hlsUrl: `https://cdn.test/${vkId}/master.m3u8`,
        },
      });
    },
  });

  const result = await provider.getAvailability(
    {
      type: "series",
      title: "Breaking Bad",
      ids: { kinopoisk: "404900" },
      seasonNumber: 1,
      episodeNumber: 1,
    },
    context(undefined, "Playback Browser/1.0"),
  );

  assert.equal(result?.options.length, 4);
  assert.deepEqual(
    result?.options.map((option) => [option.translation?.title, option.quality?.height]),
    [
      ["LostFilm", 1080],
      ["LostFilm", 720],
      ["Дубляж", 1080],
      ["Дубляж", 720],
    ],
  );
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => !url.endsWith("/333")));
  assert.deepEqual(requestUserAgents, [
    "Playback Browser/1.0",
    "Playback Browser/1.0",
    "Playback Browser/1.0",
  ]);
  assert.deepEqual(result?.options[0]?.access.headers, {
    "User-Agent": "Playback Browser/1.0",
  });
});

test("videoHubStreamingProvider resolves a movie and ignores unsupported queries", async () => {
  let calls = 0;
  const fetch: ProviderFetch = async (input) => {
    calls += 1;
    return String(input).includes("/playlist?")
      ? Response.json({ isSerial: false, items: [{ vkId: "7435895462583" }] })
      : Response.json({ sources: { mpegMediumUrl: "https://cdn.test/movie?sig=one" } });
  };
  const provider = videoHubStreamingProvider({ baseUrl: "https://videohub.test", fetch });

  const result = await provider.getAvailability({ type: "movie", kinopoisk: "258687" }, context());
  assert.equal(result?.options[0]?.quality?.height, 480);
  assert.equal(calls, 2);

  for (const query of [
    { type: "movie" as const, title: "Interstellar" },
    { type: "series" as const, kinopoisk: "404900" },
    { type: "series" as const, kinopoisk: "404900", seasonNumber: 1 },
    { type: "anime" as const, kinopoisk: "404900", absoluteEpisodeNumber: 1 },
    { type: "movie" as const, kinopoisk: "258687", providers: ["other"] },
  ]) {
    assert.equal(await provider.getAvailability(query, context()), null);
  }
  assert.equal(calls, 2);
});

test("videoHubStreamingProvider rejects type mismatches without resolving video URLs", async () => {
  let calls = 0;
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    fetch: async () => {
      calls += 1;
      return Response.json({ isSerial: true, items: [{ season: 1, episode: 1, vkId: "111" }] });
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "movie", kinopoisk: "258687" }, context()),
    null,
  );
  assert.equal(calls, 1);
});

test("videoHubStreamingProvider preserves cancellation and typed schema failures", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const cancellingProvider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    fetch: async (_input, init) => {
      throw init?.signal?.reason;
    },
  });

  await assert.rejects(
    cancellingProvider.getAvailability(
      { type: "movie", kinopoisk: "258687" },
      context(controller.signal),
    ),
    /cancelled/u,
  );

  const invalidProvider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    fetch: async () => Response.json({ isSerial: false, items: [{ nope: true }] }),
  });
  await assert.rejects(
    invalidProvider.getAvailability({ type: "movie", kinopoisk: "258687" }, context()),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});

function context(signal?: AbortSignal, playbackUserAgent?: string): ProviderContext {
  return { signal, playbackUserAgent };
}
