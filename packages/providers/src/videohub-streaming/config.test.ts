import assert from "node:assert/strict";
import test from "node:test";
import { videoHubStreamingProvider } from "./index.js";

test("videoHubStreamingProvider exposes direct Kinopoisk MP4 capabilities", () => {
  const provider = videoHubStreamingProvider({ fetch: async () => Response.json({}) });

  assert.equal(provider.name, "videohub-streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk"],
      byEpisode: true,
    },
    features: ["mp4", "translations", "qualities", "episode_mapping", "headers"],
  });
});

test("videoHubStreamingProvider validates credential-free bounded configuration", () => {
  const fetch = async () => Response.json({});

  assert.throws(() => videoHubStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => videoHubStreamingProvider({ baseUrl: "http://videohub.test", fetch }),
    /credential-free HTTPS/u,
  );
  assert.throws(
    () => videoHubStreamingProvider({ baseUrl: "https://user:secret@videohub.test", fetch }),
    /credential-free HTTPS/u,
  );

  for (const options of [
    { playlistItemLimit: 0 },
    { videoLookupLimit: 33 },
    { videoLookupConcurrency: 0 },
    { videoLookupTimeoutMs: 100 },
    { maxVideoResponseBytes: 100 },
    { linkTtlMs: 10_000 },
  ]) {
    assert.throws(
      () => videoHubStreamingProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
