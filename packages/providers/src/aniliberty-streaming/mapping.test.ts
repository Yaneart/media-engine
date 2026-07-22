import assert from "node:assert/strict";
import { test } from "node:test";

import type { AniLibertyRelease } from "./client.js";
import { mapAniLibertyAvailability } from "./mapping.js";

test("mapAniLibertyAvailability returns safe qualities and exact episode mapping", () => {
  const result = mapAniLibertyAvailability(
    "aniliberty-streaming",
    createRelease(),
    { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 1 },
    "https://aniliberty.test/api/v1/anime/releases/10290",
  );

  assert.equal(result?.episodes?.length, 1);
  assert.equal(result?.episodes?.[0]?.absoluteEpisodeNumber, 1);
  assert.deepEqual(
    result?.options.map((option) => [
      option.player.kind,
      option.quality?.height,
      option.translation?.type,
      option.availability,
    ]),
    [
      ["hls", 1080, "voiceover", "available"],
      ["hls", 720, "voiceover", "available"],
    ],
  );
  assert.equal(result?.options[0]?.translation?.language, "ru");
  assert.equal(result?.options[0]?.episode?.absoluteEpisodeNumber, 1);
  assert.equal(
    result?.options[0]?.sourceUrl,
    "https://aniliberty.test/api/v1/anime/releases/10290",
  );
});

test("mapAniLibertyAvailability exposes bounded episode maps and block status", () => {
  const release = createRelease();
  release.blockedByGeo = true;
  const result = mapAniLibertyAvailability(
    "aniliberty-streaming",
    release,
    { type: "anime", title: "One Piece", year: 1999 },
    "https://aniliberty.test/api/v1/anime/releases/10290",
  );

  assert.deepEqual(
    result?.episodes?.map((episode) => episode.absoluteEpisodeNumber),
    [1, 2],
  );
  assert.ok(result?.options.every((option) => option.availability === "region_locked"));
  assert.ok(result?.options.every((option) => option.access.url.startsWith("https://")));
});

test("mapAniLibertyAvailability preserves copyright blocks", () => {
  const release = createRelease();
  release.blockedByCopyrights = true;
  const result = mapAniLibertyAvailability(
    "aniliberty-streaming",
    release,
    { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 2 },
    "https://aniliberty.test/api/v1/anime/releases/10290",
  );

  assert.ok(result?.options.every((option) => option.availability === "temporarily_unavailable"));
});

test("mapAniLibertyAvailability returns null for missing or ambiguous episode streams", () => {
  const release = createRelease();
  release.episodes.push({
    id: "episode-1-duplicate",
    ordinal: 1,
    hls720: "https://cdn.test/duplicate/720.m3u8",
  });

  assert.equal(
    mapAniLibertyAvailability(
      "aniliberty-streaming",
      release,
      { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 1 },
      "https://aniliberty.test/api/v1/anime/releases/10290",
    ),
    null,
  );
  assert.equal(
    mapAniLibertyAvailability(
      "aniliberty-streaming",
      createRelease(),
      { type: "anime", title: "One Piece", year: 1999, absoluteEpisodeNumber: 99 },
      "https://aniliberty.test/api/v1/anime/releases/10290",
    ),
    null,
  );
});

function createRelease(): AniLibertyRelease {
  return {
    id: 10290,
    year: 1999,
    name: { main: "Ван-Пис", english: "One Piece" },
    blockedByGeo: false,
    blockedByCopyrights: false,
    episodes: [
      {
        id: "episode-1",
        name: "Episode 1",
        ordinal: 1,
        hls480: "http://127.0.0.1/unsafe.m3u8",
        hls720: "https://cdn.test/1/720.m3u8",
        hls1080: "https://cdn.test/1/1080.m3u8",
      },
      {
        id: "episode-2",
        name: "Episode 2",
        ordinal: 2,
        hls480: "https://cdn.test/2/480.m3u8",
      },
    ],
  };
}
