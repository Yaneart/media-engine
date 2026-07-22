import assert from "node:assert/strict";
import { test } from "node:test";

import { jacRedTorrentProvider } from "./index.js";

test("jacRedTorrentProvider exposes no-key title, season, and magnet capabilities", () => {
  const provider = jacRedTorrentProvider({ fetch: async () => Response.json(emptyPayload()) });

  assert.equal(provider.name, "jacred-torrent");
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

test("jacRedTorrentProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json(emptyPayload());

  assert.throws(() => jacRedTorrentProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => jacRedTorrentProvider({ baseUrl: "file:///tmp/jacred", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => jacRedTorrentProvider({ baseUrl: "https://user:secret@jacred.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(() => jacRedTorrentProvider({ baseUrl: ":", fetch }), /valid HTTP\(S\) URL/u);

  for (const searchPath of [
    "api/search",
    "//other.test/search",
    "/\\other.test/search",
    "/api/search?q=x",
  ]) {
    assert.throws(
      () => jacRedTorrentProvider({ searchPath, fetch }),
      /absolute path without query or hash/u,
    );
  }

  for (const options of [{ maxResponseBytes: 512 }, { resultLimit: 0 }, { resultLimit: 101 }]) {
    assert.throws(
      () => jacRedTorrentProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});

function emptyPayload() {
  return { query: "missing", total: 0, loaded: 0, limit: 40, open: true, results: [] };
}
