import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderError,
  type MediaAvailabilityProgressSnapshot,
  type ProviderContext,
} from "@media-engine/core";
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
    { type: "anime" as const, kinopoisk: "404900", seasonNumber: 1 },
    { type: "movie" as const, kinopoisk: "258687", providers: ["other"] },
  ]) {
    assert.equal(await provider.getAvailability(query, context()), null);
  }
  assert.equal(calls, 2);
});

test("videoHubStreamingProvider lists anime seasons without resolving episode streams", async () => {
  const requests: string[] = [];
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    now: () => Date.parse("2026-08-31T12:00:00.000Z"),
    fetch: async (input) => {
      requests.push(String(input));
      return Response.json({
        titleName: "Seasonal Anime",
        isSerial: true,
        items: [
          { season: 1, episode: 2, voiceStudio: "Dub", vkId: "201" },
          { season: 0, episode: 1, voiceStudio: "Special", vkId: "401" },
          { season: 1, episode: 1, voiceStudio: "Dub", vkId: "101" },
          { season: 1, episode: 1, voiceStudio: "Sub", vkId: "102" },
          { season: 2, episode: 1, voiceStudio: "Dub", vkId: "301" },
        ],
      });
    },
  });

  const result = await provider.getAvailability(
    { type: "anime", ids: { kinopoisk: "5401195", aniList: "154587" } },
    context(),
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(result?.options, []);
  assert.deepEqual(
    result?.seasons?.map((season) => [season.seasonNumber, season.episodesCount]),
    [
      [0, 1],
      [1, 2],
      [2, 1],
    ],
  );
  assert.deepEqual(
    result?.episodes?.map((episode) => [
      episode.seasonNumber,
      episode.episodeNumber,
      episode.absoluteEpisodeNumber,
    ]),
    [
      [0, 1, undefined],
      [1, 1, 1],
      [1, 2, 2],
      [2, 1, 3],
    ],
  );
});

test("videoHubStreamingProvider resolves an anime absolute episode as a serial playlist", async () => {
  const requestedVideos: string[] = [];
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    now: () => Date.parse("2026-08-30T12:00:00.000Z"),
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/playlist?")) {
        return Response.json({
          titleName: "Провожающая в последний путь Фрирен",
          isSerial: true,
          items: [
            { season: 1, episode: 2, voiceStudio: "Dub", vkId: "201" },
            { season: 1, episode: 1, voiceStudio: "Dub", vkId: "101" },
            { season: 1, episode: 1, voiceStudio: "Sub", vkId: "102" },
          ],
        });
      }

      const vkId = new URL(url).pathname.split("/").at(-1)!;
      requestedVideos.push(vkId);
      return Response.json({
        sources: { mpegFullHdUrl: `https://cdn.test/${vkId}/1080.mp4` },
      });
    },
  });

  const result = await provider.getAvailability(
    {
      type: "anime",
      title: "Frieren: Beyond Journey's End",
      ids: { aniList: "154587", kinopoisk: "5401195" },
      absoluteEpisodeNumber: 1,
    },
    context(undefined, "Playback Browser/1.0"),
  );

  assert.deepEqual(requestedVideos, ["101", "102"]);
  assert.equal(result?.item?.type, "anime");
  assert.deepEqual(result?.item?.ids, { aniList: "154587", kinopoisk: "5401195" });
  assert.deepEqual(result?.episodes?.[0], {
    seasonNumber: 1,
    episodeNumber: 1,
    absoluteEpisodeNumber: 1,
    options: result?.options,
  });
  assert.ok(
    result?.options.every(
      (option) =>
        option.episode?.seasonNumber === 1 &&
        option.episode.episodeNumber === 1 &&
        option.episode.absoluteEpisodeNumber === 1,
    ),
  );
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

test("videoHubStreamingProvider publishes ready translations immediately in playlist order", async () => {
  const videoResponses = new Map<string, (response: Response) => void>();
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    videoLookupConcurrency: 2,
    now: () => Date.parse("2026-09-01T12:00:00.000Z"),
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/playlist?")) {
        return Response.json({
          titleName: "Progressive Movie",
          isSerial: false,
          items: [
            { voiceStudio: "First", vkId: "111" },
            { voiceStudio: "Second", vkId: "222" },
          ],
        });
      }

      const vkId = new URL(url).pathname.split("/").at(-1)!;
      return new Promise<Response>((resolve) => videoResponses.set(vkId, resolve));
    },
  });
  const iterator = provider.getAvailabilityProgressively!(
    { type: "movie", kinopoisk: "258687" },
    context(),
  )[Symbol.asyncIterator]();

  const firstPending = iterator.next();
  await waitFor(() => videoResponses.size === 2);
  videoResponses.get("222")?.(
    Response.json({ sources: { mpegHighUrl: "https://cdn.test/222/720.mp4" } }),
  );
  const first = (await firstPending).value as MediaAvailabilityProgressSnapshot;
  assert.equal(first.state, "pending");
  assert.deepEqual(
    first.availability?.options.map((option) => option.translation?.title),
    ["Second"],
  );

  const secondPending = iterator.next();
  videoResponses.get("111")?.(
    Response.json({ sources: { mpegFullHdUrl: "https://cdn.test/111/1080.mp4" } }),
  );
  const second = (await secondPending).value as MediaAvailabilityProgressSnapshot;
  assert.deepEqual(
    second.availability?.options.map((option) => option.translation?.title),
    ["First", "Second"],
  );

  const complete = (await iterator.next()).value as MediaAvailabilityProgressSnapshot;
  assert.equal(complete.state, "complete");
  assert.deepEqual(
    complete.availability?.options.map((option) => option.id),
    second.availability?.options.map((option) => option.id),
  );
  assert.equal((await iterator.next()).done, true);
});

test("videoHubStreamingProvider completes partial success after a later lookup fails", async () => {
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    videoLookupConcurrency: 1,
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/playlist?")) {
        return Response.json({
          isSerial: false,
          items: [
            { voiceStudio: "Working", vkId: "111" },
            { voiceStudio: "Broken", vkId: "222" },
          ],
        });
      }
      return url.endsWith("/111")
        ? Response.json({ sources: { mpegHighUrl: "https://cdn.test/111/720.mp4" } })
        : Response.json({ unexpected: true });
    },
  });

  const snapshots = [];
  for await (const snapshot of provider.getAvailabilityProgressively!(
    { type: "movie", kinopoisk: "258687" },
    context(),
  )) {
    snapshots.push(snapshot);
  }

  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.state, snapshot.availability?.options.length]),
    [
      ["pending", 1],
      ["complete", 1],
    ],
  );
});

test("videoHubStreamingProvider aborts remaining lookups when progress iteration stops", async () => {
  let slowLookupAborted = false;
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    videoLookupConcurrency: 2,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/playlist?")) {
        return Response.json({
          isSerial: false,
          items: [{ vkId: "111" }, { vkId: "222" }],
        });
      }
      if (url.endsWith("/111")) {
        return Response.json({ sources: { mpegHighUrl: "https://cdn.test/111/720.mp4" } });
      }

      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          slowLookupAborted = true;
          reject(init?.signal?.reason);
        };
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  });
  const iterator = provider.getAvailabilityProgressively!(
    { type: "movie", kinopoisk: "258687" },
    context(),
  )[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value?.state, "pending");
  await iterator.return?.(undefined);
  await waitFor(() => slowLookupAborted);
  assert.equal(slowLookupAborted, true);
});

test("videoHubStreamingProvider reuses warm playlist and valid signed video resolutions", async () => {
  let now = Date.parse("2026-09-01T12:00:00.000Z");
  let playlistCalls = 0;
  let videoCalls = 0;
  const provider = videoHubStreamingProvider({
    baseUrl: "https://videohub.test",
    now: () => now,
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("/playlist?")) {
        playlistCalls += 1;
        return Response.json({ isSerial: false, items: [{ vkId: "111" }] });
      }
      videoCalls += 1;
      return Response.json({
        sources: { mpegHighUrl: `https://cdn.test/111/720.mp4?generation=${videoCalls}` },
      });
    },
  });
  const query = { type: "movie" as const, kinopoisk: "258687" };

  const cold = await provider.getAvailability(query, context());
  const warm = await provider.getAvailability(query, context());

  assert.equal(playlistCalls, 1);
  assert.equal(videoCalls, 1);
  assert.equal(warm?.options[0]?.access.url, cold?.options[0]?.access.url);
  assert.equal(warm?.options[0]?.expiresAt, cold?.options[0]?.expiresAt);

  now += 299_000;
  const refreshed = await provider.getAvailability(query, context());
  assert.equal(playlistCalls, 1);
  assert.equal(videoCalls, 2);
  assert.notEqual(refreshed?.options[0]?.access.url, cold?.options[0]?.access.url);
  assert.ok(
    Date.parse(refreshed?.options[0]?.expiresAt ?? "") >
      Date.parse(cold?.options[0]?.expiresAt ?? ""),
  );
});

function context(signal?: AbortSignal, playbackUserAgent?: string): ProviderContext {
  return { signal, playbackUserAgent };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for progressive VideoHUB test state.");
}
