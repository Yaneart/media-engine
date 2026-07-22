import assert from "node:assert/strict";
import { test } from "node:test";

import { ytsTorrentProvider } from "./index.js";

test("ytsTorrentProvider exposes no-key movie and IMDb capabilities", () => {
  const provider = ytsTorrentProvider({ fetch: async () => Response.json(emptyPayload()) });

  assert.equal(provider.name, "yts-torrent");
  assert.equal(provider.kind, "torrent");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie"],
    lookup: {
      byTitle: true,
      byExternalIds: ["imdb"],
      byEpisode: false,
    },
    features: ["magnet", "peer_stats", "release_metadata"],
  });
});

test("ytsTorrentProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json(emptyPayload());

  assert.throws(() => ytsTorrentProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => ytsTorrentProvider({ baseUrl: "file:///tmp/yts", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => ytsTorrentProvider({ baseUrl: "https://user:secret@yts.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );

  for (const options of [{ maxResponseBytes: 512 }, { resultLimit: 0 }, { resultLimit: 51 }]) {
    assert.throws(() => ytsTorrentProvider({ ...options, fetch }), /must be an integer between/u);
  }
});

function emptyPayload() {
  return { status: "ok", status_message: "Query was successful", data: { movie_count: 0 } };
}
