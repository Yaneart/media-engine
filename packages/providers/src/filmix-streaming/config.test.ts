import assert from "node:assert/strict";
import { test } from "node:test";

import { filmixStreamingProvider } from "./index.js";

test("filmixStreamingProvider exposes guest MP4 capabilities", () => {
  const provider = filmixStreamingProvider({
    deviceId: "0123456789abcdef",
    fetch: async () => Response.json([]),
  });

  assert.equal(provider.name, "filmix-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series"],
    lookup: { byTitle: true, byExternalIds: [], byEpisode: true },
    features: ["mp4", "translations", "qualities", "episode_mapping"],
  });
});

test("filmixStreamingProvider validates bounded credential-free configuration", () => {
  const fetch = async () => Response.json([]);

  assert.throws(() => filmixStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => filmixStreamingProvider({ baseUrl: "file:///tmp/filmix", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => filmixStreamingProvider({ siteBaseUrl: "https://user:secret@filmix.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => filmixStreamingProvider({ deviceId: "not-a-device-id", fetch }),
    /16 hexadecimal/u,
  );

  for (const options of [
    { maxResponseBytes: 512 },
    { searchResultLimit: 101 },
    { seasonLimit: 501 },
    { translationLimit: 101 },
    { episodeLimit: 2_001 },
    { linkTtlMs: 59_999 },
  ]) {
    assert.throws(
      () =>
        filmixStreamingProvider({
          ...options,
          deviceId: "0123456789abcdef",
          fetch,
        }),
      /must be an integer between/u,
    );
  }
});
