import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

import {
  buildImdbDatasetSqliteIndex,
  imdbDatasetProvider,
  IMDB_DATASET_SQLITE_SCHEMA_VERSION,
  openImdbDatasetSqliteStorage,
} from "./index.js";

const gzipAsync = promisify(gzip);
const sqliteModule = await import("node:sqlite").catch(() => undefined);
const sqliteTestOptions = {
  skip: sqliteModule ? false : "requires Node.js 22.13 or newer with node:sqlite",
};

const TITLE_BASICS_TSV = [
  "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
  "tt0816692\tmovie\tInterstellar\tInterstellar\t0\t2014\t\\N\t169\tAdventure,Drama,Sci-Fi",
  "tt0944947\ttvSeries\tGame of Thrones\tGame of Thrones\t0\t2011\t2019\t57\tAction,Adventure,Drama",
  "tt0000001\tshort\tCarmencita\tCarmencita\t0\t1894\t\\N\t1\tDocumentary,Short",
  "tt9999999\tmovie\tHidden Adult\tHidden Adult\t1\t2020\t\\N\t90\tDrama",
].join("\n");

const TITLE_RATINGS_TSV = [
  "tconst\taverageRating\tnumVotes",
  "tt0816692\t8.7\t2300000",
  "tt0944947\t9.2\t2400000",
  "tt0000001\t5.7\t2100",
].join("\n");

test(
  "SQLite IMDb storage builds a versioned index and preserves provider output",
  sqliteTestOptions,
  async (context) => {
    const fixture = await createFixture(context);
    const progress: string[] = [];
    const result = await buildImdbDatasetSqliteIndex({
      ...fixture,
      onProgress(event) {
        progress.push(event.phase);
      },
    });

    assert.equal(result.schemaVersion, IMDB_DATASET_SQLITE_SCHEMA_VERSION);
    assert.equal(result.titleRows, 2);
    assert.equal(result.ratingRows, 2);
    assert.equal(result.skippedTitleRows, 2);
    assert.ok(result.indexBytes > 0);
    assert.ok(progress.includes("titles"));
    assert.ok(progress.includes("ratings"));
    assert.ok(progress.includes("finalize"));

    const storage = await openImdbDatasetSqliteStorage({ path: fixture.outputPath });
    const provider = imdbDatasetProvider({ storage });

    try {
      const exact = await provider.search({ title: "Interstellar", type: "movie" }, {});
      const substring = await provider.search({ title: "stellar" }, {});
      const prefix = await provider.search({ title: "Game of", year: 2011 }, {});
      const wrongType = await provider.search({ title: "Interstellar", type: "series" }, {});
      const details = await provider.getDetails?.({ ids: { imdb: "tt0944947" } }, {});

      assert.equal(exact[0]?.item.ids?.imdb, "tt0816692");
      assert.equal(exact[0]?.item.ratings?.[0]?.value, 8.7);
      assert.equal(substring[0]?.item.title, "Interstellar");
      assert.equal(substring[0]?.confidence, 0.75);
      assert.equal(prefix[0]?.item.title, "Game of Thrones");
      assert.equal(wrongType.length, 0);
      assert.equal(details?.details.runtimeMinutes, 57);
      assert.equal(storage.schemaVersion, IMDB_DATASET_SQLITE_SCHEMA_VERSION);
    } finally {
      storage.close();
    }

    assert.throws(() => storage.getTitleById("tt0816692"), /storage is closed/);
  },
);

test("SQLite IMDb import streams gzip TSV inputs", sqliteTestOptions, async (context) => {
  const directory = await createTemporaryDirectory(context);
  const titleBasicsPath = join(directory, "title.basics.tsv.gz");
  const titleRatingsPath = join(directory, "title.ratings.tsv.gz");
  const outputPath = join(directory, "imdb.sqlite");
  await Promise.all([
    writeFile(titleBasicsPath, await gzipAsync(TITLE_BASICS_TSV)),
    writeFile(titleRatingsPath, await gzipAsync(TITLE_RATINGS_TSV)),
  ]);

  const result = await buildImdbDatasetSqliteIndex({
    titleBasicsPath,
    titleRatingsPath,
    outputPath,
  });
  const storage = await openImdbDatasetSqliteStorage({ path: outputPath });

  try {
    assert.equal(result.titleRows, 2);
    assert.equal((await storage.getTitleById("tt0816692"))?.rating?.numVotes, 2_300_000);
  } finally {
    storage.close();
  }
});

test(
  "an interrupted SQLite IMDb rebuild preserves the previous index",
  sqliteTestOptions,
  async (context) => {
    const fixture = await createFixture(context);
    await buildImdbDatasetSqliteIndex(fixture);
    const controller = new AbortController();

    await assert.rejects(
      buildImdbDatasetSqliteIndex({
        ...fixture,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.phase === "titles") {
            controller.abort(new DOMException("Cancelled", "AbortError"));
          }
        },
      }),
      { name: "AbortError" },
    );

    const storage = await openImdbDatasetSqliteStorage({ path: fixture.outputPath });

    try {
      assert.equal((await storage.getTitleById("tt0816692"))?.primaryTitle, "Interstellar");
    } finally {
      storage.close();
    }

    const files = await readdir(join(fixture.outputPath, ".."));
    assert.equal(
      files.some((name) => name.endsWith(".tmp")),
      false,
    );
  },
);

test(
  "a malformed SQLite IMDb rebuild cannot replace the previous index",
  sqliteTestOptions,
  async (context) => {
    const fixture = await createFixture(context);
    await buildImdbDatasetSqliteIndex(fixture);
    await writeFile(fixture.titleBasicsPath, "wrong\theader\nvalue\tvalue");

    await assert.rejects(buildImdbDatasetSqliteIndex(fixture), /missing required column tconst/);
    const storage = await openImdbDatasetSqliteStorage({ path: fixture.outputPath });

    try {
      assert.equal((await storage.getTitleById("tt0944947"))?.primaryTitle, "Game of Thrones");
    } finally {
      storage.close();
    }
  },
);

test(
  "SQLite IMDb index validates paths, options, schema identity, and cancellation",
  sqliteTestOptions,
  async (context) => {
    const fixture = await createFixture(context);
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await assert.rejects(
      buildImdbDatasetSqliteIndex({
        ...fixture,
        outputPath: fixture.titleBasicsPath,
      }),
      /outputPath must differ/,
    );
    await assert.rejects(buildImdbDatasetSqliteIndex({ ...fixture, signal: controller.signal }), {
      name: "AbortError",
    });
    await assert.rejects(
      openImdbDatasetSqliteStorage({ path: fixture.titleBasicsPath }),
      /not a database|not a Media Engine/,
    );
    await assert.rejects(
      openImdbDatasetSqliteStorage({ path: fixture.outputPath, busyTimeoutMs: 60_001 }),
      RangeError,
    );
  },
);

test(
  "SQLite IMDb storage rejects an unsupported schema version",
  sqliteTestOptions,
  async (context) => {
    assert.ok(sqliteModule);
    const fixture = await createFixture(context);
    await buildImdbDatasetSqliteIndex(fixture);
    const database = new sqliteModule.DatabaseSync(fixture.outputPath);
    database.exec("PRAGMA user_version = 999");
    database.close();

    await assert.rejects(
      openImdbDatasetSqliteStorage({ path: fixture.outputPath }),
      /Unsupported IMDb SQLite schema version 999/,
    );
  },
);

async function createFixture(context: TestContext) {
  const directory = await createTemporaryDirectory(context);
  const titleBasicsPath = join(directory, "title.basics.tsv");
  const titleRatingsPath = join(directory, "title.ratings.tsv");
  const outputPath = join(directory, "imdb.sqlite");
  await Promise.all([
    writeFile(titleBasicsPath, TITLE_BASICS_TSV),
    writeFile(titleRatingsPath, TITLE_RATINGS_TSV),
  ]);

  return { titleBasicsPath, titleRatingsPath, outputPath };
}

async function createTemporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "media-engine-imdb-sqlite-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
