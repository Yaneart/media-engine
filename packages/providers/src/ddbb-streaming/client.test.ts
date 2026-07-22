import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createDdbbLookupUrl, parseDdbbResponse } from "./client.js";

test("parseDdbbResponse accepts bounded nullable players and translations", () => {
  const players = parseDdbbResponse("ddbb-test", {
    data: [
      {
        type: " Alloha ",
        iframeUrl: "https://alloha.test/main",
        translations: [
          {
            id: 87,
            name: "Профессиональный многоголосый",
            quality: "FHD (1080p)",
            iframeUrl: "https://alloha.test/87",
          },
          { id: null, name: null, quality: null, iframeUrl: null },
          "invalid",
        ],
      },
      { type: "Collaps", iframeUrl: null, translations: [] },
      { type: 42, iframeUrl: null, translations: [] },
    ],
  });

  assert.deepEqual(players, [
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
        {},
      ],
    },
    { type: "Collaps", translations: [] },
  ]);
});

test("parseDdbbResponse rejects schema drift but permits an empty data array", () => {
  assert.deepEqual(parseDdbbResponse("ddbb-test", { data: [] }), []);

  for (const value of [{}, { data: null }, { data: [null, "broken"] }]) {
    assert.throws(
      () => parseDdbbResponse("ddbb-test", value),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("createDdbbLookupUrl emits only the selected external ID and stable mode", () => {
  assert.equal(
    createDdbbLookupUrl("https://ddbb.test", { source: "kinopoisk", id: "258687" }).href,
    "https://ddbb.test/api/players?kinopoisk=258687&n=0",
  );
  assert.equal(
    createDdbbLookupUrl("https://ddbb.test", { source: "imdb", id: "tt0816692" }).href,
    "https://ddbb.test/api/players?imdb=tt0816692&n=0",
  );
});
