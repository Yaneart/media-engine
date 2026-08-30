import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedVideoHubItem } from "./client.js";
import { mapVideoHubAvailability } from "./mapping.js";

const now = Date.parse("2026-08-22T12:00:00.000Z");
const playbackUserAgent = "Playback Browser/1.0";

test("mapVideoHubAvailability creates voice and quality options for an exact episode", () => {
  const items: ResolvedVideoHubItem[] = [
    {
      vkId: "7631928449556",
      seasonNumber: 1,
      episodeNumber: 1,
      voiceStudio: "LostFilm",
      voiceType: "Многоголосый",
      sourceUrl: "https://videohub.test/api/v1/player/sv/video/7631928449556",
      sources: [
        { url: "https://cdn.test/1080?sig=one", label: "1080p", height: 1080 },
        { url: "https://cdn.test/720?sig=two", label: "720p", height: 720 },
      ],
    },
  ];
  const query = {
    type: "series" as const,
    title: "Breaking Bad",
    year: 2008,
    ids: { kinopoisk: "404900" },
    seasonNumber: 1,
    episodeNumber: 1,
  };

  const result = mapVideoHubAvailability(
    "videohub-streaming",
    "404900",
    "Во все тяжкие",
    items,
    query,
    "https://videohub.test/playlist?id=404900",
    now,
    300_000,
    playbackUserAgent,
  );

  assert.equal(result?.item?.title, "Во все тяжкие");
  assert.deepEqual(result?.item?.ids, { kinopoisk: "404900" });
  assert.equal(result?.options.length, 2);
  assert.deepEqual(result?.options[0]?.translation, {
    title: "LostFilm",
    type: "voiceover",
    team: "LostFilm",
  });
  assert.deepEqual(result?.options[0]?.quality, { label: "1080p", height: 1080 });
  assert.deepEqual(result?.options[0]?.episode, { seasonNumber: 1, episodeNumber: 1 });
  assert.equal(result?.options[0]?.player.kind, "mp4");
  assert.equal(result?.options[0]?.availability, "available");
  assert.equal(result?.options[0]?.expiresAt, "2026-08-22T12:05:00.000Z");
  assert.deepEqual(result?.options[0]?.access.headers, {
    "User-Agent": playbackUserAgent,
  });
  assert.equal(result?.episodes?.[0]?.options, result?.options);
});

test("mapVideoHubAvailability classifies dubbing and removes exact duplicate options", () => {
  const item: ResolvedVideoHubItem = {
    vkId: "7435895462583",
    voiceType: "Дубляж",
    sourceUrl: "https://videohub.test/video/7435895462583",
    sources: [
      { url: "https://cdn.test/movie?sig=one", label: "720p", height: 720 },
      { url: "https://cdn.test/movie?sig=one", label: "720p", height: 720 },
    ],
  };

  const result = mapVideoHubAvailability(
    "videohub-streaming",
    "258687",
    "Интерстеллар",
    [item],
    { type: "movie", ids: { kinopoisk: "258687" } },
    "https://videohub.test/playlist?id=258687",
    now,
    300_000,
    playbackUserAgent,
  );

  assert.equal(result?.options.length, 1);
  assert.deepEqual(result?.options[0]?.translation, { title: "Дубляж", type: "dub" });
});

test("mapVideoHubAvailability returns null without playable MP4 sources", () => {
  assert.equal(
    mapVideoHubAvailability(
      "videohub-streaming",
      "258687",
      undefined,
      [],
      { type: "movie", kinopoisk: "258687" },
      "https://videohub.test/playlist?id=258687",
      now,
      300_000,
      playbackUserAgent,
    ),
    null,
  );
});

test("mapVideoHubAvailability preserves anime type and seasonal plus absolute episode refs", () => {
  const item: ResolvedVideoHubItem = {
    vkId: "101",
    seasonNumber: 1,
    episodeNumber: 1,
    absoluteEpisodeNumber: 1,
    voiceStudio: "Dub",
    sourceUrl: "https://videohub.test/video/101",
    sources: [{ url: "https://cdn.test/anime-1080.mp4", label: "1080p", height: 1080 }],
  };
  const result = mapVideoHubAvailability(
    "videohub-streaming",
    "5401195",
    "Провожающая в последний путь Фрирен",
    [item],
    {
      type: "anime",
      ids: { aniList: "154587", kinopoisk: "5401195" },
      absoluteEpisodeNumber: 1,
    },
    "https://videohub.test/playlist?id=5401195",
    now,
    300_000,
    playbackUserAgent,
  );

  assert.equal(result?.item?.type, "anime");
  assert.deepEqual(result?.item?.ids, { aniList: "154587", kinopoisk: "5401195" });
  assert.deepEqual(result?.options[0]?.episode, {
    seasonNumber: 1,
    episodeNumber: 1,
    absoluteEpisodeNumber: 1,
  });
  assert.deepEqual(result?.episodes?.[0], {
    seasonNumber: 1,
    episodeNumber: 1,
    absoluteEpisodeNumber: 1,
    options: result?.options,
  });
});
