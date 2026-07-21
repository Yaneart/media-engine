import type { DatabaseSync } from "node:sqlite";

export const IMDB_DATASET_SQLITE_SCHEMA_VERSION = 1;
export const IMDB_DATASET_SQLITE_APPLICATION_ID = 0x4d454449;

const SCHEMA_SQL = `
  PRAGMA page_size = 4096;
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = FILE;
  PRAGMA cache_size = -16384;
  PRAGMA locking_mode = EXCLUSIVE;
  PRAGMA application_id = ${IMDB_DATASET_SQLITE_APPLICATION_ID};
  PRAGMA user_version = ${IMDB_DATASET_SQLITE_SCHEMA_VERSION};

  CREATE TABLE metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE titles (
    id INTEGER PRIMARY KEY,
    imdb_id TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'series')),
    primary_title TEXT NOT NULL,
    original_title TEXT,
    start_year INTEGER,
    end_year INTEGER,
    runtime_minutes INTEGER,
    genres TEXT,
    normalized_primary_title TEXT NOT NULL,
    normalized_original_title TEXT NOT NULL
  );

  CREATE INDEX titles_primary_title_idx
    ON titles(normalized_primary_title, media_type, start_year DESC);
  CREATE INDEX titles_original_title_idx
    ON titles(normalized_original_title, media_type, start_year DESC);

  CREATE TABLE ratings (
    imdb_id TEXT PRIMARY KEY NOT NULL REFERENCES titles(imdb_id) ON DELETE CASCADE,
    average_rating REAL NOT NULL,
    num_votes INTEGER
  ) WITHOUT ROWID;

  CREATE VIRTUAL TABLE title_search USING fts5(
    normalized_primary_title,
    normalized_original_title,
    content='',
    tokenize='trigram remove_diacritics 1'
  );

  INSERT INTO metadata(key, value) VALUES
    ('state', 'building'),
    ('schema_version', '${IMDB_DATASET_SQLITE_SCHEMA_VERSION}');
`;

export function createImdbDatasetSqliteSchema(database: DatabaseSync): void {
  try {
    database.exec(SCHEMA_SQL);
  } catch (error) {
    throw new Error(
      "Unable to create the IMDb SQLite index; Node.js SQLite must include FTS5 trigram support",
      { cause: error },
    );
  }
}

export function validateImdbDatasetSqliteSchema(database: DatabaseSync): void {
  const applicationId = readPragmaNumber(database, "application_id");
  const schemaVersion = readPragmaNumber(database, "user_version");
  const state = database.prepare("SELECT value FROM metadata WHERE key = 'state'").get()?.value;

  if (applicationId !== IMDB_DATASET_SQLITE_APPLICATION_ID) {
    throw new Error("File is not a Media Engine IMDb SQLite index");
  }

  if (schemaVersion !== IMDB_DATASET_SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported IMDb SQLite schema version ${schemaVersion}; expected ${IMDB_DATASET_SQLITE_SCHEMA_VERSION}`,
    );
  }

  if (state !== "ready") {
    throw new Error("IMDb SQLite index is incomplete");
  }
}

export function validateImdbDatasetSqliteIntegrity(database: DatabaseSync): void {
  const result = database.prepare("PRAGMA quick_check(1)").get();
  const status = result ? Object.values(result)[0] : undefined;

  if (status !== "ok") {
    throw new Error(`IMDb SQLite index integrity check failed: ${String(status)}`);
  }
}

function readPragmaNumber(database: DatabaseSync, name: "application_id" | "user_version"): number {
  const result = database.prepare(`PRAGMA ${name}`).get();
  const value = result?.[name];

  return typeof value === "number" ? value : Number.NaN;
}
