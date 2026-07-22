import assert from "node:assert/strict";
import { test } from "node:test";

import { aniLibertyStreamingProvider } from "./index.js";

test("aniLibertyStreamingProvider exposes no-token title and episode capabilities", () => {
  const provider = aniLibertyStreamingProvider({ fetch: async () => Response.json([]) });

  assert.equal(provider.name, "aniliberty-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["anime"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: ["hls", "translations", "qualities", "episode_mapping"],
  });
});

test("aniLibertyStreamingProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json([]);

  assert.throws(() => aniLibertyStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => aniLibertyStreamingProvider({ baseUrl: "file:///tmp/aniliberty", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () =>
      aniLibertyStreamingProvider({
        baseUrl: "https://user:secret@aniliberty.test",
        fetch,
      }),
    /credential-free HTTP\(S\)/u,
  );

  for (const options of [
    { maxResponseBytes: 512 },
    { searchResultLimit: 101 },
    { episodeLimit: 1_001 },
  ]) {
    assert.throws(
      () => aniLibertyStreamingProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
