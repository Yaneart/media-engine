import assert from "node:assert/strict";
import { test } from "node:test";

import { createLookupUrl, parseVeoVeoContentId } from "./lookup.js";
import { ProviderError } from "@media-engine/core";
import { createCatalogUrl, parseVeoVeoCatalog, resolveVeoVeoLookup } from "./client.js";

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

test("parseVeoVeoContentId reads one public ID without evaluating scripts", () => {
  assert.equal(
    parseVeoVeoContentId("veo-test", "<script>window.MOVIE_ID = 31869;</script>"),
    "31869",
  );
  assert.equal(
    parseVeoVeoContentId("veo-test", "window.MOVIE_ID=31869;window.MOVIE_ID=31869;"),
    "31869",
  );
  assert.equal(parseVeoVeoContentId("veo-test", "<html><body></body></html>"), undefined);
  for (const html of [
    "window.MOVIE_ID=10;window.MOVIE_ID=11;",
    "window.MOVIE_ID=-1;",
    "window.MOVIE_ID=1+2;",
    "window.MOVIE_ID=0;",
  ]) {
    assert.throws(
      () => parseVeoVeoContentId("veo-test", html),
      (error) => error instanceof ProviderError && error.code === "PROVIDER_INVALID_RESPONSE",
    );
  }
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
    "https://lookup.test/balancer-api/iframe?kp=4541515",
  );
  assert.equal(
    createCatalogUrl("https://veo.test/root", "31869").href,
    "https://veo.test/balancer-api/proxy/playlists/catalog-api/episodes?content-id=31869",
  );
});
