import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import {
  createCatalogUrl,
  createLookupUrl,
  parseVeoVeoCatalog,
  parseVeoVeoContentId,
  resolveVeoVeoLookup,
} from "./client.js";

test("resolveVeoVeoLookup prefers Kinopoisk and validates external IDs", () => {
  assert.deepEqual(
    resolveVeoVeoLookup({
      type: "series",
      ids: { kinopoisk: "4541515", imdb: "tt14688458" },
    }),
    { source: "kinopoisk", id: "4541515" },
  );
  assert.deepEqual(resolveVeoVeoLookup({ type: "movie", imdb: "tt0816692" }), {
    source: "imdb",
    id: "tt0816692",
  });
  assert.equal(resolveVeoVeoLookup({ type: "movie", kinopoisk: "bad" }), undefined);
});

test("parseVeoVeoContentId extracts one ID and discards iframe tokens", () => {
  const payload = {
    data: [
      { type: "Collaps", iframeUrl: "https://other.test/embed", translations: [] },
      {
        type: "Veo veo",
        iframeUrl: "https://player.test/iframe?movie_id=31869&token=secret-one",
        translations: [
          {
            iframeUrl: "https://player.test/iframe?token=secret-two&movie_id=31869",
          },
          { iframeUrl: "http://player.test/iframe?movie_id=999" },
        ],
      },
    ],
  };

  assert.equal(parseVeoVeoContentId("veo-test", payload), "31869");
  assert.equal(JSON.stringify(parseVeoVeoContentId("veo-test", payload)).includes("secret"), false);
});

test("parseVeoVeoContentId rejects ambiguous or malformed lookup responses", () => {
  assert.equal(
    parseVeoVeoContentId("veo-test", {
      data: [
        { type: "VeoVeo", iframeUrl: "https://player.test/?movie_id=10", translations: [] },
        { type: "VeoVeo", iframeUrl: "https://player.test/?movie_id=11", translations: [] },
      ],
    }),
    undefined,
  );
  assert.throws(
    () => parseVeoVeoContentId("veo-test", []),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});

test("parseVeoVeoCatalog parses and bounds catalog items and variants", () => {
  const catalog = parseVeoVeoCatalog(
    "veo-test",
    [
      {
        order: 1,
        title: "Episode 1",
        season: { order: 3 },
        episodeVariants: [
          { title: "720p", filepath: "https://cdn.test/s03e01/master.m3u8?sig=x" },
          { title: "JSON", filepath: "https://cdn.test/s03e01/source.json" },
        ],
      },
      { order: "bad", season: { order: 3 }, episodeVariants: [] },
    ],
    10,
    1,
  );

  assert.deepEqual(catalog, [
    {
      seasonNumber: 3,
      episodeNumber: 1,
      title: "Episode 1",
      variants: [{ title: "720p", url: "https://cdn.test/s03e01/master.m3u8?sig=x" }],
    },
  ]);
  assert.throws(
    () => parseVeoVeoCatalog("veo-test", { data: [] }, 10, 2),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
  );
});

test("VeoVeo request URLs contain only the lookup ID and public content ID", () => {
  assert.equal(
    createLookupUrl("https://lookup.test/root", { source: "kinopoisk", id: "4541515" }).href,
    "https://lookup.test/api/players?kinopoisk=4541515&n=0",
  );
  assert.equal(
    createCatalogUrl("https://veo.test/root", "31869").href,
    "https://veo.test/balancer-api/proxy/playlists/catalog-api/episodes?content-id=31869",
  );
});
