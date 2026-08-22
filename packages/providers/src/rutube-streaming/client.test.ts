import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createRutubeSearchUrl, parseRutubeSearchResponse } from "./client.js";

test("createRutubeSearchUrl creates one bounded public movie search", () => {
  const url = createRutubeSearchUrl(
    { baseUrl: "https://rutube.test", searchResultLimit: 20 },
    " Начало ",
    2010,
  );

  assert.equal(url.pathname, "/api/search/video/");
  assert.equal(url.searchParams.get("content_type"), "video");
  assert.equal(url.searchParams.get("duration"), "movie");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("query"), "Начало 2010");
});

test("parseRutubeSearchResponse bounds and strictly parses candidate state", () => {
  const parsed = parseRutubeSearchResponse(
    "rutube-streaming",
    { results: [createCandidate(), { ...createCandidate(), id: "b".repeat(32) }] },
    1,
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, "a".repeat(32));
  assert.equal(parsed[0]?.categoryId, 4);
  assert.equal(parsed[0]?.paid, false);
});

test("parseRutubeSearchResponse reports an invalid schema as a typed failure", () => {
  assert.throws(
    () => parseRutubeSearchResponse("rutube-streaming", { results: [{ id: "bad" }] }, 20),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      return true;
    },
  );
});

function createCandidate() {
  return {
    id: "a".repeat(32),
    title: "Начало (фильм, 2010)",
    duration: 8_888,
    category: { id: 4 },
    is_hidden: false,
    is_deleted: false,
    is_adult: false,
    is_locked: false,
    is_audio: false,
    is_paid: false,
    is_livestream: false,
  };
}
