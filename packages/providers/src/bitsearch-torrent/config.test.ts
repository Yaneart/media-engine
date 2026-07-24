import assert from "node:assert/strict";
import { test } from "node:test";

import { bitsearchTorrentProvider } from "./index.js";
import { createEmptyBitsearchTorrentPayload } from "./test-helpers.js";

test("bitsearchTorrentProvider exposes no-key title, episode, and magnet capabilities", () => {
  const provider = bitsearchTorrentProvider({
    fetch: async () => Response.json(createEmptyBitsearchTorrentPayload()),
  });

  assert.equal(provider.name, "bitsearch-torrent");
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

test("bitsearchTorrentProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json(createEmptyBitsearchTorrentPayload());

  assert.throws(() => bitsearchTorrentProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => bitsearchTorrentProvider({ baseUrl: "file:///tmp/bitsearch", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => bitsearchTorrentProvider({ baseUrl: "https://user:secret@bitsearch.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(() => bitsearchTorrentProvider({ baseUrl: ":", fetch }), /valid HTTP\(S\) URL/u);

  for (const searchPath of [
    "api/v1/search",
    "//other.test/search",
    "/\\other.test/search",
    "/api/v1/search?q=x",
  ]) {
    assert.throws(
      () => bitsearchTorrentProvider({ searchPath, fetch }),
      /absolute path without query or hash/u,
    );
  }

  for (const options of [{ maxResponseBytes: 512 }, { resultLimit: 0 }, { resultLimit: 101 }]) {
    assert.throws(
      () => bitsearchTorrentProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
