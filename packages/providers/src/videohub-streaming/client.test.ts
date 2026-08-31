import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@media-engine/core";
import {
  createVideoHubPlaylistUrl,
  createVideoHubVideoUrl,
  parseVideoHubPlaylist,
  parseVideoHubSources,
  resolveVideoHubKinopoiskId,
  selectVideoHubPlaylistItems,
} from "./client.js";

test("VideoHUB URL builders use the public Kinopoisk and video contracts", () => {
  assert.equal(
    createVideoHubPlaylistUrl("https://videohub.test", "258687").href,
    "https://videohub.test/api/v1/player/sv/playlist?pub=12&aggr=kp&id=258687",
  );
  assert.equal(
    createVideoHubVideoUrl("https://videohub.test", "7435895462583").href,
    "https://videohub.test/api/v1/player/sv/video/7435895462583",
  );
});

test("resolveVideoHubKinopoiskId accepts only normalized Kinopoisk IDs", () => {
  assert.equal(
    resolveVideoHubKinopoiskId({ type: "movie", ids: { kinopoisk: "258687" } }),
    "258687",
  );
  assert.equal(resolveVideoHubKinopoiskId({ type: "movie", kinopoisk: "258687" }), "258687");
  assert.equal(resolveVideoHubKinopoiskId({ type: "movie", kinopoisk: "kp258687" }), undefined);
  assert.equal(resolveVideoHubKinopoiskId({ type: "movie", kinopoisk: "0" }), undefined);
});

test("parseVideoHubPlaylist bounds and normalizes a series catalog", () => {
  assert.deepEqual(
    parseVideoHubPlaylist(
      "videohub-streaming",
      {
        titleName: " Во все тяжкие ",
        isSerial: true,
        items: [
          {
            season: 1,
            episode: 1,
            voiceStudio: " LostFilm ",
            voiceType: " Многоголосый ",
            vkId: 7631928449556,
          },
          { season: 1, episode: 2, vkId: "7635180345876" },
        ],
      },
      1,
    ),
    {
      title: "Во все тяжкие",
      isSerial: true,
      items: [
        {
          seasonNumber: 1,
          episodeNumber: 1,
          voiceStudio: "LostFilm",
          voiceType: "Многоголосый",
          vkId: "7631928449556",
        },
      ],
    },
  );
});

test("parseVideoHubPlaylist rejects structurally invalid non-empty catalogs", () => {
  assert.throws(
    () =>
      parseVideoHubPlaylist(
        "videohub-streaming",
        { isSerial: true, items: [{ season: -1, episode: 1, vkId: "bad" }] },
        10,
      ),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
  assert.throws(
    () => parseVideoHubPlaylist("videohub-streaming", { items: [] }, 10),
    ProviderError,
  );
});

test("parseVideoHubSources maps only fixed HTTPS MP4 fields and deduplicates URLs", () => {
  assert.deepEqual(
    parseVideoHubSources("videohub-streaming", {
      hlsUrl: "https://ignored.test/master.m3u8",
      sources: {
        hlsUrl: "https://ignored.test/master.m3u8",
        mpeg4kUrl: "http://cdn.test/4k",
        mpegFullHdUrl: "https://cdn.test/1080?sig=one",
        mpegHighUrl: "https://cdn.test/720?sig=two",
        mpegMediumUrl: "https://cdn.test/720?sig=two",
        attackerUrl: "https://ignored.test/file.mp4",
      },
    }),
    [
      { url: "https://cdn.test/1080?sig=one", label: "1080p", height: 1080 },
      { url: "https://cdn.test/720?sig=two", label: "720p", height: 720 },
    ],
  );
});

test("parseVideoHubSources rejects missing current source containers", () => {
  assert.throws(
    () => parseVideoHubSources("videohub-streaming", { hlsUrl: "https://cdn.test/a.m3u8" }),
    ProviderError,
  );
});

test("selectVideoHubPlaylistItems maps anime absolute episodes across sorted seasons", () => {
  const playlist = parseVideoHubPlaylist(
    "videohub-streaming",
    {
      isSerial: true,
      items: [
        { season: 0, episode: 1, voiceStudio: "Special", vkId: "401" },
        { season: 2, episode: 1, voiceStudio: "Dub", vkId: "301" },
        { season: 1, episode: 2, voiceStudio: "Dub", vkId: "201" },
        { season: 1, episode: 1, voiceStudio: "Dub", vkId: "101" },
        { season: 1, episode: 1, voiceStudio: "Sub", vkId: "102" },
      ],
    },
    10,
  );

  assert.deepEqual(
    selectVideoHubPlaylistItems(playlist, {
      type: "anime",
      kinopoisk: "5401195",
      absoluteEpisodeNumber: 1,
    }),
    [
      {
        seasonNumber: 1,
        episodeNumber: 1,
        absoluteEpisodeNumber: 1,
        voiceStudio: "Dub",
        vkId: "101",
      },
      {
        seasonNumber: 1,
        episodeNumber: 1,
        absoluteEpisodeNumber: 1,
        voiceStudio: "Sub",
        vkId: "102",
      },
    ],
  );
  assert.deepEqual(
    selectVideoHubPlaylistItems(playlist, {
      type: "anime",
      kinopoisk: "5401195",
      seasonNumber: 2,
      episodeNumber: 1,
    }).map((item) => [item.vkId, item.absoluteEpisodeNumber]),
    [["301", 3]],
  );
  assert.deepEqual(
    selectVideoHubPlaylistItems(playlist, {
      type: "anime",
      kinopoisk: "5401195",
      seasonNumber: 1,
      episodeNumber: 1,
      absoluteEpisodeNumber: 2,
    }),
    [],
  );
});
