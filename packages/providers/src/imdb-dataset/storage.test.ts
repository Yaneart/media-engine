import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createImdbDatasetMemoryStorage,
  imdbDatasetProvider,
  type ImdbDatasetStorage,
  type ImdbDatasetStorageSearchQuery,
  type ImdbDatasetTitleRecord,
} from "./index.js";

const INTERSTELLAR: ImdbDatasetTitleRecord = {
  imdbId: "tt0816692",
  type: "movie",
  primaryTitle: "Interstellar",
  originalTitle: "Interstellar",
  startYear: 2014,
  runtimeMinutes: 169,
  genres: ["Adventure", "Drama", "Sci-Fi"],
  rating: {
    averageRating: 8.7,
    numVotes: 2_300_000,
  },
};

test("imdbDatasetProvider accepts an asynchronous indexed storage backend", async () => {
  const controller = new AbortController();
  const queries: ImdbDatasetStorageSearchQuery[] = [];
  const storage: ImdbDatasetStorage = {
    async getTitleById() {
      return undefined;
    },
    async searchTitles(query) {
      queries.push(query);
      return [
        { record: INTERSTELLAR, confidence: 1.5 },
        { record: { ...INTERSTELLAR, imdbId: "tt0000002" }, confidence: 0.5 },
      ];
    },
  };
  const provider = imdbDatasetProvider({ storage, searchLimit: 5 });

  const results = await provider.search(
    {
      title: "  INTERSTELLAR!! ",
      type: "movie",
      year: 2014,
      limit: 1,
    },
    { signal: controller.signal, debug: true },
  );

  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.normalizedTitle, "interstellar");
  assert.equal(queries[0]?.limit, 1);
  assert.equal(queries[0]?.type, "movie");
  assert.equal(queries[0]?.year, 2014);
  assert.equal(queries[0]?.signal, controller.signal);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.item.ids?.imdb, INTERSTELLAR.imdbId);
  assert.equal(results[0]?.item.ratings?.[0]?.votes, 2_300_000);
  assert.equal(results[0]?.confidence, 1);
  assert.deepEqual(results[0]?.raw, INTERSTELLAR);
});

test("imdbDatasetProvider uses storage ID lookup for search and details", async () => {
  const lookups: string[] = [];
  const storage: ImdbDatasetStorage = {
    getTitleById(imdbId) {
      lookups.push(imdbId);
      return imdbId === INTERSTELLAR.imdbId ? INTERSTELLAR : undefined;
    },
    searchTitles() {
      assert.fail("title search must not run for an IMDb ID query");
    },
  };
  const provider = imdbDatasetProvider({ storage });

  const search = await provider.search({ ids: { imdb: INTERSTELLAR.imdbId } }, {});
  const details = await provider.getDetails?.({ ids: { imdb: INTERSTELLAR.imdbId } }, {});

  assert.deepEqual(lookups, [INTERSTELLAR.imdbId, INTERSTELLAR.imdbId]);
  assert.equal(search[0]?.item.title, "Interstellar");
  assert.equal(details?.details.runtimeMinutes, 169);
});

test("imdbDatasetProvider rejects missing or ambiguous data sources", () => {
  assert.throws(
    () => imdbDatasetProvider({} as never),
    /requires exactly one of storage or titleBasicsTsv/,
  );
  assert.throws(
    () =>
      imdbDatasetProvider({
        storage: {
          getTitleById: () => undefined,
          searchTitles: () => [],
        },
        titleBasicsTsv: "header",
      } as never),
    /requires exactly one of storage or titleBasicsTsv/,
  );
  assert.throws(
    () => imdbDatasetProvider({ storage: null } as never),
    /must implement getTitleById and searchTitles/,
  );
});

test("imdbDatasetProvider validates direct storage query limits before lookup", async () => {
  let calls = 0;
  const provider = imdbDatasetProvider({
    storage: {
      getTitleById: () => undefined,
      searchTitles: () => {
        calls += 1;
        return [];
      },
    },
  });

  await assert.rejects(provider.search({ title: "Interstellar", limit: 101 }, {}), {
    name: "RangeError",
  });
  assert.equal(calls, 0);
});

test("imdbDatasetProvider does not call storage for an already aborted request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const storage: ImdbDatasetStorage = {
    getTitleById() {
      calls += 1;
      return undefined;
    },
    searchTitles() {
      calls += 1;
      return [];
    },
  };
  const provider = imdbDatasetProvider({ storage });
  controller.abort(new DOMException("Cancelled", "AbortError"));

  await assert.rejects(provider.search({ title: "Interstellar" }, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
});

test("createImdbDatasetMemoryStorage preserves the small-fixture adapter", async () => {
  const storage = createImdbDatasetMemoryStorage({
    titleBasicsTsv: [
      "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
      "tt0816692\tmovie\tInterstellar\tInterstellar\t0\t2014\t\\N\t169\tAdventure,Drama,Sci-Fi",
      "tt0944947\ttvSeries\tGame of Thrones\tGame of Thrones\t0\t2011\t2019\t57\tAction,Adventure,Drama",
    ].join("\n"),
  });

  const exact = await storage.getTitleById("tt0816692");
  const prefix = await storage.searchTitles({ normalizedTitle: "game of", limit: 20 });

  assert.equal(exact?.primaryTitle, "Interstellar");
  assert.equal(prefix.length, 1);
  assert.equal(prefix[0]?.record.imdbId, "tt0944947");
  assert.equal(prefix[0]?.confidence, 0.75);
});
