import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createGunzip } from "node:zlib";
import { addAbortSignal, type Readable } from "node:stream";

import { normalizeProviderSearchText } from "../shared/mapping.js";
import { createImdbSqliteDatabase, type ImdbSqliteDatabase } from "./sqlite-runtime.js";
import {
  createImdbDatasetSqliteSchema,
  IMDB_DATASET_SQLITE_SCHEMA_VERSION,
  validateImdbDatasetSqliteIntegrity,
  validateImdbDatasetSqliteSchema,
} from "./sqlite-schema.js";

const PROGRESS_INTERVAL_ROWS = 50_000;

const REQUIRED_BASICS_COLUMNS = [
  "tconst",
  "titleType",
  "primaryTitle",
  "originalTitle",
  "isAdult",
  "startYear",
  "endYear",
  "runtimeMinutes",
  "genres",
] as const;

const REQUIRED_RATINGS_COLUMNS = ["tconst", "averageRating", "numVotes"] as const;

export type ImdbDatasetSqliteBuildPhase = "titles" | "ratings" | "finalize";

export interface ImdbDatasetSqliteBuildProgress {
  phase: ImdbDatasetSqliteBuildPhase;
  processedRows: number;
  importedRows: number;
}

export interface ImdbDatasetSqliteBuildOptions {
  titleBasicsPath: string;
  titleRatingsPath?: string;
  outputPath: string;
  includeAdult?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ImdbDatasetSqliteBuildProgress) => void;
}

export interface ImdbDatasetSqliteBuildResult {
  outputPath: string;
  schemaVersion: number;
  titleRows: number;
  ratingRows: number;
  skippedTitleRows: number;
  indexBytes: number;
  durationMs: number;
}

interface ImportCounts {
  processed: number;
  imported: number;
}

// Streams official plain or gzip TSV files into a versioned index and atomically publishes it.
// Потоково импортирует plain или gzip TSV в versioned index и атомарно публикует его.
export async function buildImdbDatasetSqliteIndex(
  options: ImdbDatasetSqliteBuildOptions,
): Promise<ImdbDatasetSqliteBuildResult> {
  const startedAt = performance.now();
  const titleBasicsPath = resolveRequiredPath(options.titleBasicsPath, "titleBasicsPath");
  const titleRatingsPath = options.titleRatingsPath
    ? resolveRequiredPath(options.titleRatingsPath, "titleRatingsPath")
    : undefined;
  const outputPath = resolveRequiredPath(options.outputPath, "outputPath");

  if (outputPath === titleBasicsPath || outputPath === titleRatingsPath) {
    throw new TypeError("IMDb SQLite outputPath must differ from every input path");
  }

  options.signal?.throwIfAborted();
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let database: ImdbSqliteDatabase | undefined;

  try {
    database = await createImdbSqliteDatabase(temporaryPath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    });
    createImdbDatasetSqliteSchema(database);
    database.exec("BEGIN IMMEDIATE");

    let titles: ImportCounts;
    let ratings: ImportCounts = { processed: 0, imported: 0 };

    try {
      titles = await importTitles(database, titleBasicsPath, options);

      if (titleRatingsPath) {
        ratings = await importRatings(database, titleRatingsPath, options);
      }

      database.prepare("UPDATE metadata SET value = 'ready' WHERE key = 'state'").run();
      database
        .prepare("INSERT INTO metadata(key, value) VALUES ('title_rows', ?)")
        .run(String(titles.imported));
      database
        .prepare("INSERT INTO metadata(key, value) VALUES ('rating_rows', ?)")
        .run(String(ratings.imported));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    options.signal?.throwIfAborted();
    emitProgress(options, "finalize", titles.processed, titles.imported);
    database.exec(
      "INSERT INTO title_search(title_search) VALUES ('optimize'); ANALYZE; PRAGMA optimize; VACUUM;",
    );
    validateImdbDatasetSqliteSchema(database);
    validateImdbDatasetSqliteIntegrity(database);
    database.close();
    database = undefined;

    await syncFile(temporaryPath);
    options.signal?.throwIfAborted();
    await rename(temporaryPath, outputPath);
    await syncDirectory(dirname(outputPath));
    const index = await stat(outputPath);

    return {
      outputPath,
      schemaVersion: IMDB_DATASET_SQLITE_SCHEMA_VERSION,
      titleRows: titles.imported,
      ratingRows: ratings.imported,
      skippedTitleRows: titles.processed - titles.imported,
      indexBytes: index.size,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (database) {
      try {
        database.close();
      } catch {
        // Preserve the original import error.
      }
    }

    await cleanupTemporaryDatabase(temporaryPath);
    throw error;
  }
}

async function importTitles(
  database: ImdbSqliteDatabase,
  path: string,
  options: ImdbDatasetSqliteBuildOptions,
): Promise<ImportCounts> {
  const insertTitle = database.prepare(`
    INSERT OR IGNORE INTO titles (
      imdb_id,
      media_type,
      primary_title,
      original_title,
      start_year,
      end_year,
      runtime_minutes,
      genres,
      normalized_primary_title,
      normalized_original_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSearch = database.prepare(`
    INSERT INTO title_search(rowid, normalized_primary_title, normalized_original_title)
    VALUES (?, ?, ?)
  `);
  const counts: ImportCounts = { processed: 0, imported: 0 };

  await forEachTsvRow(path, REQUIRED_BASICS_COLUMNS, options.signal, (values, columns) => {
    counts.processed += 1;
    checkProgress(options, "titles", counts);
    const imdbId = readValue(values, columns.tconst);
    const mediaType = mapMediaType(readValue(values, columns.titleType));
    const primaryTitle = emptyToUndefined(readValue(values, columns.primaryTitle));

    if (
      !/^tt\d{7,12}$/.test(imdbId) ||
      !mediaType ||
      !primaryTitle ||
      (!options.includeAdult && readValue(values, columns.isAdult) === "1")
    ) {
      return;
    }

    const originalTitle = emptyToUndefined(readValue(values, columns.originalTitle));
    const normalizedPrimaryTitle = normalizeProviderSearchText(primaryTitle);
    const normalizedOriginalTitle = normalizeProviderSearchText(originalTitle ?? "");

    if (!normalizedPrimaryTitle) {
      return;
    }

    const insertion = insertTitle.run(
      imdbId,
      mediaType,
      primaryTitle,
      originalTitle ?? null,
      parseNumber(readValue(values, columns.startYear)) ?? null,
      parseNumber(readValue(values, columns.endYear)) ?? null,
      parseNumber(readValue(values, columns.runtimeMinutes)) ?? null,
      emptyToUndefined(readValue(values, columns.genres)) ?? null,
      normalizedPrimaryTitle,
      normalizedOriginalTitle,
    );

    if (Number(insertion.changes) === 0) {
      return;
    }

    insertSearch.run(
      insertion.lastInsertRowid,
      normalizedPrimaryTitle,
      normalizedOriginalTitle === normalizedPrimaryTitle ? "" : normalizedOriginalTitle,
    );
    counts.imported += 1;
  });

  emitProgress(options, "titles", counts.processed, counts.imported);
  return counts;
}

async function importRatings(
  database: ImdbSqliteDatabase,
  path: string,
  options: ImdbDatasetSqliteBuildOptions,
): Promise<ImportCounts> {
  const insertRating = database.prepare(`
    INSERT OR REPLACE INTO ratings(imdb_id, average_rating, num_votes)
    SELECT ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM titles WHERE imdb_id = ?)
  `);
  const counts: ImportCounts = { processed: 0, imported: 0 };

  await forEachTsvRow(path, REQUIRED_RATINGS_COLUMNS, options.signal, (values, columns) => {
    counts.processed += 1;
    checkProgress(options, "ratings", counts);
    const imdbId = readValue(values, columns.tconst);
    const averageRating = parseNumber(readValue(values, columns.averageRating));

    if (!/^tt\d{7,12}$/.test(imdbId) || averageRating === undefined) {
      return;
    }

    const insertion = insertRating.run(
      imdbId,
      averageRating,
      parseNumber(readValue(values, columns.numVotes)) ?? null,
      imdbId,
    );
    counts.imported += Number(insertion.changes);
  });

  emitProgress(options, "ratings", counts.processed, counts.imported);
  return counts;
}

async function forEachTsvRow<const T extends readonly string[]>(
  path: string,
  requiredColumns: T,
  signal: AbortSignal | undefined,
  visit: (values: string[], columns: Record<T[number], number>) => void,
): Promise<void> {
  signal?.throwIfAborted();
  const file = createReadStream(path, { signal });
  let input: Readable = file;
  let forwardFileError: ((error: Error) => void) | undefined;

  if (path.toLowerCase().endsWith(".gz")) {
    const gunzip = createGunzip();
    forwardFileError = (error) => gunzip.destroy(error);
    file.once("error", forwardFileError);
    input = file.pipe(gunzip);

    if (signal) {
      addAbortSignal(signal, input);
    }
  }

  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let columns: Record<T[number], number> | undefined;

  try {
    for await (const rawLine of lines) {
      signal?.throwIfAborted();
      const line = rawLine.replace(/\r$/, "");

      if (!columns) {
        columns = resolveColumns(line.replace(/^\uFEFF/, ""), requiredColumns, path);
        continue;
      }

      if (line) {
        visit(line.split("\t"), columns);
      }
    }
  } finally {
    lines.close();
    input.destroy();
    file.destroy();

    if (forwardFileError) {
      file.off("error", forwardFileError);
    }
  }

  if (!columns) {
    throw new Error(`IMDb TSV file is empty: ${path}`);
  }
}

function resolveColumns<const T extends readonly string[]>(
  headerLine: string,
  requiredColumns: T,
  path: string,
): Record<T[number], number> {
  const headers = headerLine.split("\t");
  const columns = {} as Record<T[number], number>;

  for (const name of requiredColumns) {
    const index = headers.indexOf(name);

    if (index < 0) {
      throw new Error(`IMDb TSV file ${path} is missing required column ${name}`);
    }

    columns[name as T[number]] = index;
  }

  return columns;
}

function checkProgress(
  options: ImdbDatasetSqliteBuildOptions,
  phase: ImdbDatasetSqliteBuildPhase,
  counts: ImportCounts,
): void {
  if (counts.processed % 4096 === 0) {
    options.signal?.throwIfAborted();
  }

  if (counts.processed % PROGRESS_INTERVAL_ROWS === 0) {
    emitProgress(options, phase, counts.processed, counts.imported);
  }
}

function emitProgress(
  options: ImdbDatasetSqliteBuildOptions,
  phase: ImdbDatasetSqliteBuildPhase,
  processedRows: number,
  importedRows: number,
): void {
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase, processedRows, importedRows });
}

function readValue(values: string[], index: number): string {
  return values[index] ?? "";
}

function mapMediaType(value: string): "movie" | "series" | undefined {
  if (value === "movie") {
    return "movie";
  }

  if (value === "tvSeries") {
    return "series";
  }

  return undefined;
}

function parseNumber(value: string): number | undefined {
  const normalized = emptyToUndefined(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyToUndefined(value: string): string | undefined {
  return value && value !== "\\N" ? value : undefined;
}

function resolveRequiredPath(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return resolve(value);
}

async function syncFile(path: string): Promise<void> {
  const file = await open(path, "r");

  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    await syncFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "EINVAL" && code !== "EPERM" && code !== "EISDIR") {
      throw error;
    }
  }
}

async function cleanupTemporaryDatabase(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-journal`, `${path}-wal`, `${path}-shm`].map(async (candidate) => {
      try {
        await unlink(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }),
  );
}
