import assert from "node:assert/strict";
import { test } from "node:test";

import type { MagnetzTorrentRelease } from "./client.js";
import { selectMagnetzTorrentReleases } from "./matching.js";
import { MAGNETZ_INFO_HASH } from "./test-helpers.js";

function release(title: string, infoHash = MAGNETZ_INFO_HASH): MagnetzTorrentRelease {
  return {
    sqid: "xRTTwe",
    infoHash,
    title,
    sizeBytes: 1_000,
    seeders: 1,
    leechers: 0,
    verified: true,
    createdAt: "2026-06-28T20:51:14.000Z",
    sourceUrl: "https://magnetz.test/xRTTwe",
  };
}

test("selectMagnetzTorrentReleases requires exact title and explicit year", () => {
  const exact = release("Dune 2021 2160p BluRay");
  const candidates = [
    exact,
    release("Dune Messiah 2021 1080p WEBRip", "1".repeat(40)),
    release("Dune 1984 1080p BluRay", "2".repeat(40)),
  ];

  assert.deepEqual(
    selectMagnetzTorrentReleases(candidates, {
      type: "movie",
      title: "dune",
      year: 2021,
    }),
    [exact],
  );
});

test("selectMagnetzTorrentReleases requires requested season and exact episode markers", () => {
  const season = release("Game of Thrones 2011 S01-S08 1080p AV1");
  const episode = release("Game.of.Thrones.2011.S01E10.1080p.MKV", "1".repeat(40));
  const wrong = release("Game of Thrones 2011 S01E09 720p", "2".repeat(40));

  assert.deepEqual(
    selectMagnetzTorrentReleases([season, episode, wrong], {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 10,
    }),
    [episode],
  );
});

test("selectMagnetzTorrentReleases accepts strict anime season and absolute episode forms", () => {
  const season = release("[BlackRabbit] Attack on Titan (2013) - S01 1080p BluRay");
  const episode = release("[SubsPlease] One Piece - 1122 (1999) 1080p MKV", "1".repeat(40));

  assert.deepEqual(
    selectMagnetzTorrentReleases([season], {
      type: "anime",
      title: "Attack on Titan",
      year: 2013,
      seasonNumber: 1,
    }),
    [season],
  );
  assert.deepEqual(
    selectMagnetzTorrentReleases([episode], {
      type: "anime",
      title: "One Piece",
      year: 1999,
      absoluteEpisodeNumber: 1122,
    }),
    [episode],
  );
});
