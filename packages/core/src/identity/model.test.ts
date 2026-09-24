import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeIdentityId, resolveIdentityClaims, type IdentityClaim } from "./model.js";

const linked = (ids: IdentityClaim["ids"], source = "catalog"): IdentityClaim => ({
  source,
  type: "movie",
  matched: { namespace: "imdb", value: "tt0816692" },
  ids: { imdb: "tt0816692", ...ids },
});

test("normalizes only known, valid ID namespaces", () => {
  assert.equal(normalizeIdentityId("imdb", " TT0816692 "), "tt0816692");
  assert.equal(normalizeIdentityId("wikidata", " q123 "), "Q123");
  assert.equal(normalizeIdentityId("tmdb", "000157336"), "157336");
  assert.equal(normalizeIdentityId("tmdb", Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(normalizeIdentityId("tmdb", "0"), undefined);
  assert.equal(normalizeIdentityId("kinopoisk", "12foo"), undefined);
  const result = resolveIdentityClaims("movie", { imdb: " TT0816692 ", bogus: "x" }, []);
  assert.deepEqual(result.ids, { imdb: "tt0816692" });
  assert.deepEqual(result.diagnostics, [
    { code: "UNSUPPORTED_NAMESPACE", namespace: "bogus", source: "initial" },
  ]);
});

test("accepts matching source records and records provenance", () => {
  const result = resolveIdentityClaims("movie", { imdb: "tt0816692" }, [
    linked({ tmdb: "157336", wikidata: "Q13417189" }),
    linked({ tmdb: "157336" }, "other"),
  ]);
  assert.deepEqual(result.ids, { imdb: "tt0816692", tmdb: "157336", wikidata: "Q13417189" });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.provenance.filter((entry) => entry.namespace === "tmdb").map((entry) => entry.source),
    ["catalog", "other"],
  );
});

test("rejects unproven links, incompatible types, and conflicting known IDs", () => {
  const result = resolveIdentityClaims("movie", { imdb: "tt0816692", tmdb: "157336" }, [
    { ...linked({ kinopoisk: "258687" }), matched: { namespace: "imdb", value: "tt0000001" } },
    { ...linked({ kinopoisk: "258687" }), type: "series" },
    linked({ tmdb: "999", kinopoisk: "258687" }),
    { ...linked({ kinopoisk: "258687" }), ids: { kinopoisk: "258687" } },
  ]);
  assert.deepEqual(result.ids, { imdb: "tt0816692", tmdb: "157336" });
  assert.deepEqual(
    result.diagnostics.map((entry) => entry.code),
    ["UNPROVEN_LINK", "TYPE_CONFLICT", "EXTERNAL_ID_CONFLICT", "UNPROVEN_LINK"],
  );
});

test("withholds ambiguous new IDs independent of source order", () => {
  const claims = [linked({ kinopoisk: "258687" }, "a"), linked({ kinopoisk: "999" }, "b")];
  for (const ordered of [claims, [...claims].reverse()]) {
    const result = resolveIdentityClaims("movie", { imdb: "tt0816692" }, ordered);
    assert.equal(result.ids.kinopoisk, undefined);
    assert.deepEqual(result.diagnostics, [{ code: "AMBIGUOUS_ID", namespace: "kinopoisk" }]);
  }
});

test("does not use a new ID as proof until a later resolution pass", () => {
  const result = resolveIdentityClaims("movie", { imdb: "tt0816692" }, [
    linked({ tmdb: "157336" }),
    {
      source: "other",
      type: "movie",
      matched: { namespace: "tmdb", value: "157336" },
      ids: { tmdb: "157336", kinopoisk: "258687" },
    },
  ]);
  assert.equal(result.ids.tmdb, "157336");
  assert.equal(result.ids.kinopoisk, undefined);
  assert.deepEqual(result.diagnostics, [{ code: "UNPROVEN_LINK", source: "other" }]);
});
