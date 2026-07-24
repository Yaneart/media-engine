import assert from "node:assert/strict";
import { test } from "node:test";

import type { BitsearchTorrentRelease } from "./client.js";
import { selectBitsearchTorrentReleases } from "./matching.js";
import { BITSEARCH_INFO_HASH } from "./test-helpers.js";

function release(
  title: string,
  category: number,
  infoHash = BITSEARCH_INFO_HASH,
): BitsearchTorrentRelease {
  return {
    id: "616c4e220985d20990b5512d",
    infoHash,
    title,
    category,
    verified: true,
  };
}

test("selectBitsearchTorrentReleases requires exact title, year, and media category", () => {
  const dune = release("Dune.2021.1080p.WEBRip.x264", 2);
  const candidates = [
    dune,
    release("Dune Messiah 2021 1080p WEBRip", 2, "1".repeat(40)),
    release("Dune 1984 1080p BluRay", 2, "2".repeat(40)),
    release("Dune 2021 S01 1080p", 3, "3".repeat(40)),
  ];

  assert.deepEqual(
    selectBitsearchTorrentReleases(candidates, {
      type: "movie",
      title: "dune",
      year: 2021,
    }),
    [dune],
  );
});

test("selectBitsearchTorrentReleases accepts exact season packs and episodes only", () => {
  const seasonPack = release("Game of Thrones (2011) Season 1-7 S01-S07 1080p BluRay", 3);
  const episode = release("Game.of.Thrones.2011.S01.E10.720p.BluRay.x264.mkv", 3, "1".repeat(40));
  const wrongEpisode = release("Game of Thrones 2011 S01 E09 720p BluRay", 3, "2".repeat(40));

  assert.deepEqual(
    selectBitsearchTorrentReleases([seasonPack, episode, wrongEpisode], {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
    }),
    [seasonPack, episode, wrongEpisode],
  );

  assert.deepEqual(
    selectBitsearchTorrentReleases([seasonPack, episode, wrongEpisode], {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      seasonNumber: 1,
      episodeNumber: 10,
    }),
    [episode],
  );
});

test("selectBitsearchTorrentReleases recognizes named and NxE episode forms", () => {
  const named = release("The Expanse 2015 Season 2 Episode 3 1080p WEB-DL", 3);
  const xEpisode = release("The Expanse 2015 2x03-04 720p HDTV", 3, "1".repeat(40));

  assert.deepEqual(
    selectBitsearchTorrentReleases([named, xEpisode], {
      type: "series",
      title: "The Expanse",
      year: 2015,
      seasonNumber: 2,
      episodeNumber: 3,
    }),
    [named, xEpisode],
  );
});

test("selectBitsearchTorrentReleases supports explicit absolute anime episode markers", () => {
  const exact = release("[SubsPlease] One Piece - 1122 (1999) 1080p MKV", 4);
  const range = release("One Piece EP1120-1125 1999 1080p WEB-DL", 4, "1".repeat(40));
  const wrongSeason = release("One Piece S02 1999 1080p BluRay", 4, "2".repeat(40));

  assert.deepEqual(
    selectBitsearchTorrentReleases([exact, range, wrongSeason], {
      type: "anime",
      title: "One Piece",
      year: 1999,
      absoluteEpisodeNumber: 1122,
    }),
    [exact, range],
  );
});

test("selectBitsearchTorrentReleases accepts a leading release group but rejects aliases", () => {
  const exact = release("[Group] Attack on Titan S02 2013 1080p HEVC", 4);
  const unrelated = release("Attack on Titan Junior High 2013 S01 1080p", 4, "1".repeat(40));

  assert.deepEqual(
    selectBitsearchTorrentReleases([exact, unrelated], {
      type: "anime",
      title: "Attack on Titan",
      year: 2013,
    }),
    [exact],
  );
});
