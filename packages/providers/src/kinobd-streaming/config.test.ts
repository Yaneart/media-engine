import assert from "node:assert/strict";
import { test } from "node:test";

import { kinobdStreamingProvider } from "./index.js";

test("kinobdStreamingProvider exposes no-token streaming capabilities", () => {
  const provider = kinobdStreamingProvider();

  assert.equal(provider.name, "kinobd-streaming");
  assert.equal(provider.kind, "streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series", "anime"]);
  assert.deepEqual(provider.capabilities.lookup.byExternalIds, ["kinopoisk", "shikimori"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
  assert.equal(provider.capabilities.features?.includes("embed"), true);
  assert.equal(provider.capabilities.features?.includes("external"), false);
});

test("kinobdStreamingProvider validates numeric options", () => {
  assert.throws(
    () =>
      kinobdStreamingProvider({
        searchLimit: 0,
      }),
    /searchLimit/,
  );
  assert.throws(
    () =>
      kinobdStreamingProvider({
        shikimoriLookupTimeoutMs: 0,
      }),
    /shikimoriLookupTimeoutMs/,
  );
  assert.throws(
    () =>
      kinobdStreamingProvider({
        playerValidationLimit: -1,
      }),
    /playerValidationLimit/,
  );
  assert.throws(
    () =>
      kinobdStreamingProvider({
        playerValidationTimeoutMs: 0,
      }),
    /playerValidationTimeoutMs/,
  );
});
