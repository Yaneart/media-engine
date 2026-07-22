import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTorrentCacheOptions,
  mergeTorrentDiscoveryResults,
  selectTorrentProviders,
} from "./torrents.js";
import { createTorrentProvider, createTorrentResponse } from "./test-helpers.js";

test("selectTorrentProviders applies filters, lookup inputs, media types, and episode capability", () => {
  const titleOnly = createTorrentProvider({
    name: "title-only",
    capabilities: {
      mediaTypes: ["movie"],
      lookup: { byTitle: true, byExternalIds: [], byEpisode: false },
    },
  });
  const idEpisode = createTorrentProvider({
    name: "id-episode",
    capabilities: {
      mediaTypes: ["series"],
      lookup: { byTitle: false, byExternalIds: ["imdb"], byEpisode: true },
    },
  });
  const wrongId = createTorrentProvider({
    name: "wrong-id",
    capabilities: {
      mediaTypes: ["series"],
      lookup: { byTitle: false, byExternalIds: ["kinopoisk"], byEpisode: true },
    },
  });

  assert.deepEqual(
    selectTorrentProviders([titleOnly, idEpisode, wrongId], {
      type: "series",
      ids: { imdb: "tt5753856" },
      seasonNumber: 1,
      episodeNumber: 2,
    }).map((provider) => provider.name),
    ["id-episode"],
  );
  assert.deepEqual(
    selectTorrentProviders([titleOnly, idEpisode], {
      type: "movie",
      title: "Dune",
      providers: ["id-episode"],
    }),
    [],
  );
});

test("mergeTorrentDiscoveryResults preserves order and deduplicates provider identities and sources", () => {
  const query = { type: "movie", title: "Dune" } as const;
  const first = createTorrentResponse(query, "catalog");
  first.candidates.push({
    ...first.candidates[0]!,
    id: "catalog:release-2",
    title: "Dune 720p",
  });
  const duplicate = createTorrentResponse(query, "catalog");
  duplicate.sourceProviders[0]!.url = "https://example.test/catalog";
  const second = createTorrentResponse(query, "mirror");
  second.candidates.push({
    ...second.candidates[0]!,
    id: "mirror:release-2",
    title: "Dune 2160p",
  });

  const response = mergeTorrentDiscoveryResults(query, [first, duplicate, second]);

  assert.equal(response.item?.title, "Dune");
  assert.deepEqual(
    response.candidates.map(({ provider, id }) => ({ provider, id })),
    [
      { provider: "catalog", id: "catalog:release-1" },
      { provider: "mirror", id: "mirror:release-1" },
      { provider: "catalog", id: "catalog:release-2" },
      { provider: "mirror", id: "mirror:release-2" },
    ],
  );
  assert.equal(response.sourceProviders.length, 3);
  assert.match(response.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("createTorrentCacheOptions disables stale data and respects advertised expiration", () => {
  const query = { type: "movie", title: "Dune" } as const;
  const response = createTorrentResponse(query, "catalog");

  assert.deepEqual(createTorrentCacheOptions(response), { staleTtlMs: 0 });

  response.candidates[0]!.expiresAt = "not-a-date";
  assert.deepEqual(createTorrentCacheOptions(response), { staleTtlMs: 0 });

  response.candidates[0]!.expiresAt = new Date(Date.now() + 10_000).toISOString();
  const options = createTorrentCacheOptions(response);
  assert.equal(options?.staleTtlMs, 0);
  assert.ok((options?.ttlMs ?? 0) > 8_000);
  assert.ok((options?.ttlMs ?? 0) <= 9_000);
});
