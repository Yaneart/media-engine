import assert from "node:assert/strict";
import { test } from "node:test";

import { rutubeStreamingProvider } from "./index.js";

test("rutubeStreamingProvider exposes credential-free movie embed capabilities", () => {
  const provider = rutubeStreamingProvider({ fetch: async () => Response.json({ results: [] }) });

  assert.equal(provider.name, "rutube-streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie"],
    lookup: { byTitle: true, byExternalIds: [], byEpisode: false },
    features: ["embed"],
  });
});

test("rutubeStreamingProvider validates bounded HTTPS configuration", () => {
  const fetch = async () => Response.json({ results: [] });

  assert.throws(() => rutubeStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => rutubeStreamingProvider({ baseUrl: "http://rutube.test", fetch }),
    /credential-free HTTPS/u,
  );
  assert.throws(
    () => rutubeStreamingProvider({ baseUrl: "https://user:secret@rutube.test", fetch }),
    /credential-free HTTPS/u,
  );

  for (const options of [
    { maxResponseBytes: 1 },
    { searchResultLimit: 0 },
    { searchResultLimit: 51 },
    { minDurationSeconds: 59 },
  ]) {
    assert.throws(() => rutubeStreamingProvider({ ...options, fetch }), /Rutube streaming/u);
  }
});
