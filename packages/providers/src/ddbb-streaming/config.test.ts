import assert from "node:assert/strict";
import { test } from "node:test";

import { ddbbStreamingProvider } from "./index.js";

test("ddbbStreamingProvider exposes no-token external-ID capabilities without episode claims", () => {
  const provider = ddbbStreamingProvider({ fetch: async () => Response.json({ data: [] }) });

  assert.equal(provider.name, "ddbb-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities, {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk", "imdb"],
      byEpisode: false,
    },
    features: ["embed", "translations", "qualities"],
  });
});

test("ddbbStreamingProvider validates bounded configuration", () => {
  const fetch = async () => Response.json({ data: [] });

  assert.throws(() => ddbbStreamingProvider({ name: " ", fetch }), /name is required/u);
  assert.throws(
    () => ddbbStreamingProvider({ baseUrl: "file:///tmp/ddbb", fetch }),
    /credential-free HTTP\(S\)/u,
  );
  assert.throws(
    () => ddbbStreamingProvider({ baseUrl: "https://user:secret@ddbb.test", fetch }),
    /credential-free HTTP\(S\)/u,
  );

  for (const options of [
    { maxResponseBytes: 512 },
    { playerLimit: 33 },
    { playerValidationLimit: 17 },
    { playerValidationConcurrency: 5 },
    { playerValidationTimeoutMs: 0 },
    { playerValidationMaxBytes: 512 },
  ]) {
    assert.throws(
      () => ddbbStreamingProvider({ ...options, fetch }),
      /must be an integer between/u,
    );
  }
});
