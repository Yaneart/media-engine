import assert from "node:assert/strict";
import { test } from "node:test";

import { magnetzTorrentProvider } from "./index.js";
import { createEmptyMagnetzTorrentPayload } from "./test-helpers.js";

test("magnetzTorrentProvider exposes no-key title, episode, and magnet capabilities", () => {
  const provider = magnetzTorrentProvider({
    requestIntervalMs: 0,
    fetch: async () => Response.json(createEmptyMagnetzTorrentPayload()),
  });

  assert.equal(provider.name, "magnetz-torrent");
  assert.equal(provider.kind, "torrent");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: ["magnet", "peer_stats", "release_metadata"],
  });
});

test("magnetzTorrentProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json(createEmptyMagnetzTorrentPayload());

  assert.throws(() => magnetzTorrentProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => magnetzTorrentProvider({ baseUrl: "file:///tmp/magnetz", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => magnetzTorrentProvider({ baseUrl: "https://user:secret@magnetz.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(() => magnetzTorrentProvider({ baseUrl: ":", fetch }), /valid HTTP\(S\) URL/u);

  for (const searchPath of [
    "api/magnets/search",
    "//other.test/search",
    "/\\other.test/search",
    "/api/magnets/search?query=x",
  ]) {
    assert.throws(
      () => magnetzTorrentProvider({ searchPath, fetch }),
      /absolute path without query or hash/u,
    );
  }

  for (const options of [
    { maxResponseBytes: 512 },
    { resultLimit: 0 },
    { resultLimit: 26 },
    { requestIntervalMs: -1 },
    { requestIntervalMs: 5_001 },
  ]) {
    assert.throws(
      () => magnetzTorrentProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
