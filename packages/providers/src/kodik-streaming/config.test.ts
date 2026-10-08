import assert from "node:assert/strict";
import { test } from "node:test";

import { kodikStreamingProvider } from "./index.js";

test("kodikStreamingProvider exposes credentialed direct embed capabilities", () => {
  const provider = kodikStreamingProvider({
    apiKey: "owned-secret",
    fetch: async () => Response.json({ results: [] }),
  });

  assert.equal(provider.name, "kodik-streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series", "anime"],
    animeKinds: ["movie", "tv"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk", "imdb", "shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  });
  assert.equal(JSON.stringify(provider).includes("owned-secret"), false);
});

test("kodikStreamingProvider validates secret and bounded HTTPS configuration", () => {
  const fetch = async () => Response.json({ results: [] });
  assert.throws(() => kodikStreamingProvider({ apiKey: " ", fetch }), /apiKey is invalid/u);
  assert.throws(
    () => kodikStreamingProvider({ apiKey: "secret", baseUrl: "http://kodik.test", fetch }),
    /credential-free HTTPS/u,
  );
  assert.throws(
    () =>
      kodikStreamingProvider({
        apiKey: "secret",
        baseUrl: "https://user:password@kodik.test",
        fetch,
      }),
    /credential-free HTTPS/u,
  );
  assert.throws(
    () => kodikStreamingProvider({ apiKey: "secret", resultLimit: 101, fetch }),
    /must be an integer between/u,
  );
});
