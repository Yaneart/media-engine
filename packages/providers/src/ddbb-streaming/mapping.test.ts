import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaAvailability } from "@media-engine/core";
import type { DdbbPlayer } from "./client.js";
import { mapDdbbPlayers, resolveDdbbLookup } from "./mapping.js";

test("resolveDdbbLookup prefers valid Kinopoisk and falls back to IMDb", () => {
  assert.deepEqual(
    resolveDdbbLookup({
      type: "movie",
      ids: { kinopoisk: "258687", imdb: "tt0816692" },
    }),
    { source: "kinopoisk", id: "258687" },
  );
  assert.deepEqual(
    resolveDdbbLookup({ type: "movie", ids: { kinopoisk: "bad", imdb: "tt0816692" } }),
    { source: "imdb", id: "tt0816692" },
  );
  assert.equal(resolveDdbbLookup({ type: "movie", ids: { imdb: "0816692" } }), undefined);
});

test("mapDdbbPlayers preserves player diversity before unique translation URLs", () => {
  const query: MediaAvailability["query"] = {
    type: "movie",
    title: "Interstellar",
    year: 2014,
    ids: { imdb: "tt0816692" },
  };
  const players: DdbbPlayer[] = [
    {
      type: "Alloha",
      iframeUrl: "https://alloha.test/main",
      translations: [
        {
          id: "87",
          name: "Профессиональный многоголосый",
          quality: "FHD (1080p)",
          iframeUrl: "https://alloha.test/87",
        },
        {
          id: "154",
          name: "Український дубльований",
          quality: "BDRip",
          iframeUrl: "https://alloha.test/154",
        },
      ],
    },
    {
      type: "Collaps",
      iframeUrl: "https://collaps.test/main",
      translations: [
        {
          name: "Eng.Original",
          quality: "FHD (1080p)",
          iframeUrl: "https://collaps.test/main",
        },
      ],
    },
    {
      type: "Unsafe",
      iframeUrl: "http://127.0.0.1/player",
      translations: [{ name: "Русский", iframeUrl: "javascript:alert(1)" }],
    },
  ];

  const mapped = mapDdbbPlayers(
    "ddbb-test",
    players,
    query,
    { source: "kinopoisk", id: "258687" },
    "https://ddbb.test/api/players?kinopoisk=258687&n=0",
    4,
  );

  assert.deepEqual(
    mapped.options.map((option) => [
      option.player.label,
      option.translation?.title,
      option.access.url,
    ]),
    [
      ["Alloha", undefined, "https://alloha.test/main"],
      ["Collaps", undefined, "https://collaps.test/main"],
      ["Alloha", "Профессиональный многоголосый", "https://alloha.test/87"],
      ["Alloha", "Український дубльований", "https://alloha.test/154"],
    ],
  );
  assert.deepEqual(mapped.options[2]?.translation, {
    id: "87",
    title: "Профессиональный многоголосый",
    type: "voiceover",
    language: "ru",
  });
  assert.deepEqual(mapped.options[2]?.quality, { label: "FHD (1080p)", height: 1080 });
  assert.deepEqual(mapped.options[3]?.translation, {
    id: "154",
    title: "Український дубльований",
    type: "dub",
    language: "uk",
  });
  assert.deepEqual(mapped.ids, { imdb: "tt0816692", kinopoisk: "258687" });
  assert.equal(mapped.options[0]?.sourceUrl, "https://ddbb.test/api/players?kinopoisk=258687&n=0");
});
