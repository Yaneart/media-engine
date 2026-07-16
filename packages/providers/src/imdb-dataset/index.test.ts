import assert from "node:assert/strict";
import { test } from "node:test";

import { imdbDatasetProvider } from "./index.js";

const TITLE_BASICS_TSV = [
  "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
  "tt0816692\tmovie\tInterstellar\tInterstellar\t0\t2014\t\\N\t169\tAdventure,Drama,Sci-Fi",
  "tt0944947\ttvSeries\tGame of Thrones\tGame of Thrones\t0\t2011\t2019\t57\tAction,Adventure,Drama",
  "tt0000001\tshort\tCarmencita\tCarmencita\t0\t1894\t\\N\t1\tDocumentary,Short",
  "tt9999999\tmovie\tHidden Adult\tHidden Adult\t1\t2020\t\\N\t90\tDrama",
].join("\n");

test("imdbDatasetProvider validates bounded numeric options", () => {
  assert.throws(
    () => imdbDatasetProvider({ titleBasicsTsv: TITLE_BASICS_TSV, searchLimit: 0 }),
    /IMDb dataset searchLimit/,
  );
});

const TITLE_RATINGS_TSV = [
  "tconst\taverageRating\tnumVotes",
  "tt0816692\t8.7\t2300000",
  "tt0944947\t9.2\t2400000",
].join("\n");

test("imdbDatasetProvider exposes safe local metadata capabilities", () => {
  const provider = imdbDatasetProvider({ titleBasicsTsv: TITLE_BASICS_TSV });

  assert.equal(provider.name, "imdb-dataset");
  assert.equal(provider.kind, "metadata");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.deepEqual(provider.capabilities.search.byExternalIds, ["imdb"]);
  assert.deepEqual(provider.capabilities.details.byExternalIds, ["imdb"]);
});

test("imdbDatasetProvider searches movies by title from local TSV", async () => {
  const provider = imdbDatasetProvider({
    titleBasicsTsv: TITLE_BASICS_TSV,
    titleRatingsTsv: TITLE_RATINGS_TSV,
  });

  const results = await provider.search({ title: "Interstellar", type: "movie" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.provider, "imdb-dataset");
  assert.equal(results[0]?.item.title, "Interstellar");
  assert.equal(results[0]?.item.type, "movie");
  assert.equal(results[0]?.item.year, 2014);
  assert.equal(results[0]?.item.ids?.imdb, "tt0816692");
  assert.equal(results[0]?.item.ratings?.[0]?.source, "imdb");
  assert.equal(results[0]?.item.ratings?.[0]?.value, 8.7);
});

test("imdbDatasetProvider searches series by IMDb ID", async () => {
  const provider = imdbDatasetProvider({ titleBasicsTsv: TITLE_BASICS_TSV });

  const results = await provider.search({ ids: { imdb: "tt0944947" }, type: "series" }, {});

  assert.equal(results.length, 1);
  assert.equal(results[0]?.item.title, "Game of Thrones");
  assert.equal(results[0]?.item.type, "series");
});

test("imdbDatasetProvider loads details by IMDb ID", async () => {
  const provider = imdbDatasetProvider({
    titleBasicsTsv: TITLE_BASICS_TSV,
    titleRatingsTsv: TITLE_RATINGS_TSV,
  });

  const result = await provider.getDetails?.({ ids: { imdb: "tt0816692" }, type: "movie" }, {});

  assert.equal(result?.provider, "imdb-dataset");
  assert.equal(result?.details.title, "Interstellar");
  assert.equal(result?.details.runtimeMinutes, 169);
  assert.equal(result?.details.sourceProviders?.[0]?.url, "https://www.imdb.com/title/tt0816692/");
});

test("imdbDatasetProvider skips adult and unsupported title types by default", async () => {
  const provider = imdbDatasetProvider({ titleBasicsTsv: TITLE_BASICS_TSV });

  const adultResults = await provider.search({ title: "Hidden Adult", type: "movie" }, {});
  const shortResults = await provider.search({ title: "Carmencita" }, {});

  assert.equal(adultResults.length, 0);
  assert.equal(shortResults.length, 0);
});
