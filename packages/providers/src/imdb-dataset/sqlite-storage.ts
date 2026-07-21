import type { StatementSync } from "node:sqlite";
import { resolve } from "node:path";

import type {
  ImdbDatasetStorage,
  ImdbDatasetStorageLookupOptions,
  ImdbDatasetStorageSearchQuery,
  ImdbDatasetStorageSearchResult,
  ImdbDatasetTitleRecord,
} from "./storage.js";
import { createImdbSqliteDatabase, type ImdbSqliteDatabase } from "./sqlite-runtime.js";
import {
  IMDB_DATASET_SQLITE_SCHEMA_VERSION as SQLITE_SCHEMA_VERSION,
  validateImdbDatasetSqliteSchema,
} from "./sqlite-schema.js";

export const IMDB_DATASET_SQLITE_SCHEMA_VERSION = SQLITE_SCHEMA_VERSION;

const DEFAULT_BUSY_TIMEOUT_MS = 1_000;
const MAX_BUSY_TIMEOUT_MS = 60_000;

const SELECT_COLUMNS = `
  t.imdb_id,
  t.media_type,
  t.primary_title,
  t.original_title,
  t.start_year,
  t.end_year,
  t.runtime_minutes,
  t.genres,
  t.normalized_primary_title,
  t.normalized_original_title,
  r.average_rating,
  r.num_votes
`;

const LOOKUP_SQL = `
  SELECT ${SELECT_COLUMNS}
  FROM titles AS t
  LEFT JOIN ratings AS r ON r.imdb_id = t.imdb_id
  WHERE t.imdb_id = ?
`;

const SEARCH_SQL = `
  SELECT ${SELECT_COLUMNS}
  FROM title_search
  JOIN titles AS t ON t.id = title_search.rowid
  LEFT JOIN ratings AS r ON r.imdb_id = t.imdb_id
  WHERE title_search MATCH ?
    AND (? IS NULL OR t.media_type = ?)
    AND (? IS NULL OR t.start_year = ?)
  ORDER BY
    CASE
      WHEN t.normalized_primary_title = ? OR t.normalized_original_title = ? THEN 0
      ELSE 1
    END,
    COALESCE(t.start_year, 0) DESC,
    t.imdb_id ASC
  LIMIT ?
`;

const PREFIX_SEARCH_SQL = `
  SELECT ${SELECT_COLUMNS}
  FROM titles AS t
  LEFT JOIN ratings AS r ON r.imdb_id = t.imdb_id
  WHERE (
      t.normalized_primary_title GLOB ?
      OR t.normalized_original_title GLOB ?
    )
    AND (? IS NULL OR t.media_type = ?)
    AND (? IS NULL OR t.start_year = ?)
  ORDER BY
    CASE
      WHEN t.normalized_primary_title = ? OR t.normalized_original_title = ? THEN 0
      ELSE 1
    END,
    COALESCE(t.start_year, 0) DESC,
    t.imdb_id ASC
  LIMIT ?
`;

export interface ImdbDatasetSqliteStorageOptions {
  path: string;
  busyTimeoutMs?: number;
}

export interface ImdbDatasetSqliteStorage extends ImdbDatasetStorage {
  readonly path: string;
  readonly schemaVersion: number;
  close(): void;
}

// Opens a read-only persisted IMDb index without affecting the legacy TSV path.
// Открывает read-only постоянный IMDb index, не затрагивая прежний TSV-путь.
export async function openImdbDatasetSqliteStorage(
  options: ImdbDatasetSqliteStorageOptions,
): Promise<ImdbDatasetSqliteStorage> {
  const path = resolveRequiredPath(options.path, "IMDb SQLite index path");
  const timeout = resolveBusyTimeout(options.busyTimeoutMs);
  const database = await createImdbSqliteDatabase(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });

  try {
    validateImdbDatasetSqliteSchema(database);
    database.exec(
      `PRAGMA query_only = ON; PRAGMA busy_timeout = ${timeout}; PRAGMA cache_size = -8192; PRAGMA trusted_schema = OFF;`,
    );
    return new SqliteStorage(database, path);
  } catch (error) {
    database.close();
    throw error;
  }
}

class SqliteStorage implements ImdbDatasetSqliteStorage {
  readonly schemaVersion = SQLITE_SCHEMA_VERSION;
  readonly path: string;

  private readonly database: ImdbSqliteDatabase;
  private readonly lookupStatement: StatementSync;
  private readonly searchStatement: StatementSync;
  private readonly prefixSearchStatement: StatementSync;
  private closed = false;

  constructor(database: ImdbSqliteDatabase, path: string) {
    this.database = database;
    this.path = path;
    this.lookupStatement = database.prepare(LOOKUP_SQL);
    this.searchStatement = database.prepare(SEARCH_SQL);
    this.prefixSearchStatement = database.prepare(PREFIX_SEARCH_SQL);
  }

  getTitleById(
    imdbId: string,
    options?: ImdbDatasetStorageLookupOptions,
  ): ImdbDatasetTitleRecord | undefined {
    this.assertOpen();
    options?.signal?.throwIfAborted();
    const row = this.lookupStatement.get(imdbId);
    options?.signal?.throwIfAborted();

    return row ? mapRow(row) : undefined;
  }

  searchTitles(query: ImdbDatasetStorageSearchQuery): ImdbDatasetStorageSearchResult[] {
    this.assertOpen();
    query.signal?.throwIfAborted();
    const prefixRows = this.prefixSearchStatement.all(
      `${query.normalizedTitle}*`,
      `${query.normalizedTitle}*`,
      query.type ?? null,
      query.type ?? null,
      query.year ?? null,
      query.year ?? null,
      query.normalizedTitle,
      query.normalizedTitle,
      query.limit,
    );
    const hasExactMatch = prefixRows.some((row) => isExactRow(row, query.normalizedTitle));
    let rows: Record<string, unknown>[] = prefixRows;

    if (
      !hasExactMatch &&
      prefixRows.length < query.limit &&
      [...query.normalizedTitle].length >= 3
    ) {
      const substringRows = this.searchStatement.all(
        quoteFtsPhrase(query.normalizedTitle),
        query.type ?? null,
        query.type ?? null,
        query.year ?? null,
        query.year ?? null,
        query.normalizedTitle,
        query.normalizedTitle,
        query.limit,
      );
      rows = mergeSearchRows(prefixRows, substringRows, query.limit);
    }

    query.signal?.throwIfAborted();

    return rows.map((row) => ({
      record: mapRow(row),
      confidence: isExactRow(row, query.normalizedTitle) ? 1 : 0.75,
    }));
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("IMDb SQLite storage is closed");
    }
  }
}

function mergeSearchRows(
  prefixRows: Record<string, unknown>[],
  substringRows: Record<string, unknown>[],
  limit: number,
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();

  for (const row of [...prefixRows, ...substringRows]) {
    const imdbId = readRequiredString(row.imdb_id, "imdb_id");

    if (!merged.has(imdbId)) {
      merged.set(imdbId, row);
    }
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        (readOptionalNumber(right.start_year) ?? 0) - (readOptionalNumber(left.start_year) ?? 0) ||
        readRequiredString(left.imdb_id, "imdb_id").localeCompare(
          readRequiredString(right.imdb_id, "imdb_id"),
        ),
    )
    .slice(0, limit);
}

function isExactRow(row: Record<string, unknown>, normalizedTitle: string): boolean {
  return (
    row.normalized_primary_title === normalizedTitle ||
    row.normalized_original_title === normalizedTitle
  );
}

function mapRow(row: Record<string, unknown>): ImdbDatasetTitleRecord {
  const imdbId = readRequiredString(row.imdb_id, "imdb_id");
  const mediaType = readRequiredString(row.media_type, "media_type");
  const primaryTitle = readRequiredString(row.primary_title, "primary_title");

  if (mediaType !== "movie" && mediaType !== "series") {
    throw new Error(`Invalid IMDb SQLite media type for ${imdbId}`);
  }

  const rating = readOptionalNumber(row.average_rating);
  const genres = readOptionalString(row.genres);

  return {
    imdbId,
    type: mediaType,
    primaryTitle,
    originalTitle: readOptionalString(row.original_title),
    startYear: readOptionalNumber(row.start_year),
    endYear: readOptionalNumber(row.end_year),
    runtimeMinutes: readOptionalNumber(row.runtime_minutes),
    genres: genres?.split(",").filter(Boolean),
    rating:
      rating === undefined
        ? undefined
        : {
            averageRating: rating,
            numVotes: readOptionalNumber(row.num_votes),
          },
  };
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readRequiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Invalid IMDb SQLite ${column} value`);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveRequiredPath(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return resolve(value);
}

function resolveBusyTimeout(value: number | undefined): number {
  const resolved = value ?? DEFAULT_BUSY_TIMEOUT_MS;

  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > MAX_BUSY_TIMEOUT_MS) {
    throw new RangeError(`IMDb SQLite busyTimeoutMs must be between 0 and ${MAX_BUSY_TIMEOUT_MS}`);
  }

  return resolved;
}
