import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockFetch, createProvider, type RequestRecord } from "./test-helpers.js";

test("kinobdStreamingProvider maps movie playerdata into embed options", async () => {
  const requests: RequestRecord[] = [];
  const provider = createProvider({
    fetch: createMockFetch(requests, {
      "GET /api/player/search": {
        data: [
          {
            id: 94666,
            kinopoisk_id: 258687,
            imdb_id: "tt0816692",
            title: "Интерстеллар",
            name_original: "Interstellar",
            year: 2014,
            iframe: '<iframe src="//kinobd.test/player/94666"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        kodik: {
          translate: "Дубляж",
          iframe: '<iframe data-src="//kodik.test/video/94666"></iframe>',
          quality: "1080p",
        },
        vk: {
          translate: "Private network",
          iframe: "http://127.0.0.1:8080/player",
          quality: "auto",
        },
        trailer: {
          translate: "Trailer",
          iframe: "https://youtube.test/embed/trailer",
          quality: "auto",
        },
        netflix: {
          translate: "Netflix",
          iframe: "https://kinobd.test/film_netflix/94666",
          quality: "auto",
        },
        torrent: {
          translate: "Torrent",
          iframe: "https://kinobd.test/torrent/94666",
          quality: "auto",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      ids: {
        kinopoisk: "258687",
      },
    },
    {},
  );

  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.path, "/api/player/search");
  assert.equal(requests[0]?.query.get("q"), "258687");
  assert.equal(requests[0]?.query.get("type"), "kp_id");
  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[1]?.path, "/playerdata");
  assert.equal(requests[1]?.search, "?cache94666");
  assert.equal(requests[1]?.body.get("inid"), "94666");
  assert.equal(requests[1]?.body.get("player")?.includes("kodik"), true);
  assert.equal(requests[1]?.body.get("player")?.includes("ia"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("netflix"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("torrent"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("trailer"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("youtube"), false);
  assert.equal(requests[1]?.body.get("player")?.includes("vk"), true);
  assert.equal(requests[1]?.body.get("player")?.includes("nf"), false);
  assert.equal(availability?.item?.title, "Интерстеллар");
  assert.deepEqual(availability?.item?.ids, {
    imdb: "tt0816692",
    kinopoisk: "258687",
  });
  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["KODIK"],
  );
  assert.deepEqual(
    availability?.options.map((option) => option.player.kind),
    ["embed"],
  );
  assert.equal(availability?.options[0]?.access.url, "https://kodik.test/video/94666");
  assert.equal(availability?.options[0]?.translation?.title, "Дубляж");
  assert.equal(availability?.options[0]?.translation?.type, "dub");
  assert.equal(availability?.options[0]?.translation?.language, "ru");
  assert.equal(availability?.options[0]?.quality?.height, 1080);
});

test("kinobdStreamingProvider infers translation language and type", async () => {
  const provider = createProvider({
    fetch: createMockFetch([], {
      "GET /api/player/search": {
        data: [
          {
            id: 94666,
            kinopoisk_id: 258687,
            title: "Интерстеллар",
            name_original: "Interstellar",
            year: 2014,
            iframe: '<iframe src="//kinobd.test/player/94666"></iframe>',
          },
        ],
      },
      "POST /playerdata": {
        ashdi: {
          translate: "багатоголосий закадровий | UATeam, DniproFilm",
          iframe: "https://ashdi.test/video/94666",
          quality: "1080p",
        },
        collaps: {
          translate: "English subtitles",
          iframe: "https://collaps.test/video/94666",
          quality: "1080p",
        },
        vibix: {
          translate: "2x2",
          iframe: "https://vibix.test/video/94666",
          quality: "720p",
        },
        kodik: {
          translate: "Shachiburi",
          iframe: "https://kodik.test/video/94666",
          quality: "720p",
        },
        flixcdn: {
          translate: "AlexFilm",
          iframe: "https://flixcdn.test/video/94666",
          quality: "720p",
        },
        alloha: {
          translate: "HDrezka Studio",
          iframe: "https://alloha.test/video/94666",
          quality: "720p",
        },
        videocdn: {
          translate: "LE-Production",
          iframe: "https://videocdn.test/video/94666",
          quality: "720p",
        },
        moonwalk: {
          translate: "Оригинал",
          iframe: "https://moonwalk.test/video/94666",
          quality: "1080p",
        },
        bazon: {
          translate: "Субтитры",
          iframe: "https://bazon.test/video/94666",
          quality: "1080p",
        },
      },
    }),
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      ids: {
        kinopoisk: "258687",
      },
    },
    {},
  );

  assert.deepEqual(
    availability?.options.map((option) => option.translation),
    [
      {
        title: "багатоголосий закадровий | UATeam, DniproFilm",
        type: "voiceover",
        language: "uk",
      },
      {
        title: "English subtitles",
        type: "subtitles",
        language: "en",
      },
      {
        title: "2x2",
        type: "voiceover",
        language: "ru",
        team: "2x2",
      },
      {
        title: "Shachiburi",
        type: "voiceover",
        language: "ru",
        team: "shachiburi",
      },
      {
        title: "AlexFilm",
        type: "voiceover",
        language: "ru",
        team: "alexfilm",
      },
      {
        title: "HDrezka Studio",
        type: "voiceover",
        language: "ru",
        team: "hdrezka studio",
      },
      {
        title: "LE-Production",
        type: "voiceover",
        language: "ru",
        team: "le-production",
      },
      {
        title: "Оригинал",
        type: "original",
        language: undefined,
      },
      {
        title: "Субтитры",
        type: "subtitles",
        language: undefined,
      },
    ],
  );
});
