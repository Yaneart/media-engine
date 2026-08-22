import assert from "node:assert/strict";
import { test } from "node:test";

import { veoVeoStreamingProvider } from "./index.js";

test("veoVeoStreamingProvider exposes direct external-ID HLS capabilities", () => {
  const provider = veoVeoStreamingProvider({ fetch: async () => Response.json([]) });

  assert.equal(provider.name, "veoveo-streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series"],
    lookup: { byTitle: false, byExternalIds: ["kinopoisk", "imdb"], byEpisode: true },
    features: ["hls", "translations", "qualities", "episode_mapping"],
  });
});

test("veoVeoStreamingProvider validates credential-free bounded configuration", () => {
  const fetch = async () => Response.json([]);

  assert.throws(() => veoVeoStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => veoVeoStreamingProvider({ lookupBaseUrl: "file:///tmp/lookup", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => veoVeoStreamingProvider({ streamBaseUrl: "https://user:secret@veo.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );

  for (const options of [
    { maxLookupResponseBytes: 512 },
    { maxCatalogResponseBytes: 17 * 1024 * 1024 },
    { catalogItemLimit: 0 },
    { variantLimit: 33 },
    { linkTtlMs: 10_000 },
  ]) {
    assert.throws(
      () => veoVeoStreamingProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
