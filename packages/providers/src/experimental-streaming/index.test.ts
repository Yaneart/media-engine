import assert from "node:assert/strict";
import { test } from "node:test";

import { experimentalStreamingProvider } from "./index.js";

test("experimentalStreamingProvider exposes safe streaming capabilities", () => {
  const provider = experimentalStreamingProvider({
    entries: [
      {
        type: "anime",
        title: "Example Anime",
        ids: {
          shikimori: "20",
        },
        episodes: [
          {
            absoluteEpisodeNumber: 1,
            options: [createEmbedOption("episode-1-dub", "AniDUB", "720p")],
          },
        ],
      },
    ],
  });

  assert.equal(provider.name, "experimental-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["anime"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.deepEqual(provider.capabilities.lookup.byExternalIds, ["shikimori"]);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
  assert.equal("entries" in provider, false);
});

test("experimentalStreamingProvider returns multiple player options for an episode", async () => {
  const provider = experimentalStreamingProvider({
    name: "local-embed",
    entries: [
      {
        type: "anime",
        title: "Example Anime",
        year: 2026,
        ids: {
          shikimori: "20",
        },
        sourceUrl: "https://example.test/anime/20",
        episodes: [
          {
            absoluteEpisodeNumber: 1,
            title: "Episode 1",
            options: [
              createEmbedOption("episode-1-dub", "AniDUB", "720p"),
              createEmbedOption("episode-1-sub", "Subtitles", "1080p", "subtitles"),
            ],
          },
          {
            absoluteEpisodeNumber: 2,
            title: "Episode 2",
            options: [createEmbedOption("episode-2-dub", "AniDUB", "720p")],
          },
        ],
      },
    ],
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      ids: {
        shikimori: "20",
      },
      absoluteEpisodeNumber: 1,
    },
    {},
  );

  assert.equal(availability?.item?.title, "Example Anime");
  assert.equal(availability?.sourceProviders[0]?.url, "https://example.test/anime/20");
  assert.equal(availability?.episodes?.length, 1);
  assert.equal(availability?.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.equal(availability?.options.length, 2);
  assert.deepEqual(
    availability?.options.map((option) => option.translation?.type),
    ["dub", "subtitles"],
  );
  assert.deepEqual(
    availability?.options.map((option) => option.provider),
    ["local-embed", "local-embed"],
  );
});

test("experimentalStreamingProvider matches configured title when external IDs are absent", async () => {
  const provider = experimentalStreamingProvider({
    entries: [
      {
        type: "movie",
        title: "Example Movie",
        year: 2026,
        options: [createEmbedOption("movie-main", "Original", "1080p", "original")],
      },
    ],
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      title: " example   movie ",
      year: 2026,
    },
    {},
  );

  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.id, "movie-main");
});

test("experimentalStreamingProvider respects provider restrictions", async () => {
  const provider = experimentalStreamingProvider({
    name: "local-embed",
    entries: [
      {
        type: "movie",
        title: "Example Movie",
        options: [createEmbedOption("movie-main", "Original", "1080p", "original")],
      },
    ],
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      title: "Example Movie",
      providers: ["other-provider"],
    },
    {},
  );

  assert.equal(availability, null);
});

test("experimentalStreamingProvider removes unsafe output URLs before returning availability", async () => {
  const signedUrl = "https://player.test/embed/movie?token=a%2Fb%2Bc&expires=1800000000";
  const provider = experimentalStreamingProvider({
    entries: [
      {
        type: "movie",
        title: "Example Movie",
        sourceUrl: "http://127.0.0.1/source",
        options: [
          {
            id: "safe",
            player: { kind: "embed", label: "Safe" },
            access: {
              url: signedUrl,
              referer: "http://localhost/referrer",
              headers: {
                Referer: "http://192.168.0.1/referrer",
                Origin: "https://player.test",
                "X-Player": "fixture",
              },
            },
            subtitles: [
              { label: "Safe", url: "https://captions.test/en.vtt?signature=a%2Fb" },
              { label: "Unsafe", url: "javascript:alert(1)" },
            ],
            sourceUrl: "file:///tmp/source",
            availability: "available",
          },
          {
            id: "unsafe",
            player: { kind: "embed", label: "Unsafe" },
            access: { url: "http://169.254.169.254/latest/meta-data" },
            availability: "available",
          },
        ],
      },
    ],
  });

  const availability = await provider.getAvailability(
    { type: "movie", title: "Example Movie" },
    {},
  );

  assert.equal(availability?.sourceProviders[0]?.url, undefined);
  assert.equal(availability?.options.length, 1);
  assert.equal(availability?.options[0]?.access.url, signedUrl);
  assert.equal(availability?.options[0]?.access.referer, undefined);
  assert.deepEqual(availability?.options[0]?.access.headers, {
    Origin: "https://player.test/",
    "X-Player": "fixture",
  });
  assert.equal(availability?.options[0]?.sourceUrl, undefined);
  assert.deepEqual(availability?.options[0]?.subtitles, [
    { label: "Safe", url: "https://captions.test/en.vtt?signature=a%2Fb" },
    { label: "Unsafe", url: undefined },
  ]);
});

function createEmbedOption(
  id: string,
  translationTitle: string,
  qualityLabel: string,
  translationType: "dub" | "subtitles" | "original" = "dub",
) {
  return {
    id,
    player: {
      kind: "embed" as const,
      label: "Embed Player",
    },
    translation: {
      title: translationTitle,
      type: translationType,
      language: "ru",
    },
    quality: {
      label: qualityLabel,
      height: Number.parseInt(qualityLabel, 10),
    },
    access: {
      url: `https://example.test/embed/${id}`,
    },
    availability: "available" as const,
  };
}
