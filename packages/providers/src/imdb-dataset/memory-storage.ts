import { normalizeProviderSearchText } from "../shared/mapping.js";
import type {
  ImdbDatasetRatingRecord,
  ImdbDatasetStorage,
  ImdbDatasetStorageSearchQuery,
  ImdbDatasetStorageSearchResult,
  ImdbDatasetTitleRecord,
} from "./storage.js";

// Input accepted by the backward-compatible in-memory TSV adapter.
// Входные данные backward-compatible in-memory TSV adapter.
export interface ImdbDatasetMemoryStorageOptions {
  titleBasicsTsv: string;
  titleRatingsTsv?: string;
  includeAdult?: boolean;
}

interface IndexedTitleRecord extends ImdbDatasetTitleRecord {
  normalizedPrimaryTitle: string;
  normalizedOriginalTitle: string;
}

// Builds the legacy in-memory adapter used for small fixtures and compatibility.
// Создаёт прежний in-memory adapter для малых fixtures и совместимости.
export function createImdbDatasetMemoryStorage(
  options: ImdbDatasetMemoryStorageOptions,
): ImdbDatasetStorage {
  const recordsById = new Map<string, IndexedTitleRecord>();
  const ratingsById = parseRatings(options.titleRatingsTsv);

  for (const row of parseTsv(options.titleBasicsTsv)) {
    const record = mapTitleBasicsRow(row, options.includeAdult ?? false);

    if (record) {
      recordsById.set(record.imdbId, record);
    }
  }

  return {
    getTitleById(imdbId, lookupOptions) {
      lookupOptions?.signal?.throwIfAborted();
      const record = recordsById.get(imdbId);
      return record ? createStorageRecord(record, ratingsById.get(imdbId)) : undefined;
    },
    searchTitles(query) {
      return searchMemoryStorage(recordsById, ratingsById, query);
    },
  };
}

function searchMemoryStorage(
  recordsById: ReadonlyMap<string, IndexedTitleRecord>,
  ratingsById: ReadonlyMap<string, ImdbDatasetRatingRecord>,
  query: ImdbDatasetStorageSearchQuery,
): ImdbDatasetStorageSearchResult[] {
  query.signal?.throwIfAborted();
  const matches: Array<{ record: IndexedTitleRecord; confidence: number }> = [];
  let visited = 0;

  for (const record of recordsById.values()) {
    if (visited % 4096 === 0) {
      query.signal?.throwIfAborted();
    }
    visited += 1;

    if (
      (query.type !== undefined && record.type !== query.type) ||
      (query.year !== undefined && record.startYear !== query.year)
    ) {
      continue;
    }

    const confidence = scoreTitle(record, query.normalizedTitle);

    if (confidence <= 0) {
      continue;
    }

    const candidate = { record, confidence };
    const worstMatch = matches.at(-1);

    if (
      matches.length >= query.limit &&
      worstMatch &&
      compareSearchMatches(candidate, worstMatch) >= 0
    ) {
      continue;
    }

    matches.push(candidate);
    matches.sort(compareSearchMatches);

    if (matches.length > query.limit) {
      matches.pop();
    }
  }

  query.signal?.throwIfAborted();
  return matches.map(({ record, confidence }) => ({
    record: createStorageRecord(record, ratingsById.get(record.imdbId)),
    confidence,
  }));
}

function mapTitleBasicsRow(
  row: Record<string, string>,
  includeAdult: boolean,
): IndexedTitleRecord | undefined {
  const type = mapTitleType(row.titleType);

  if (!type || (!includeAdult && row.isAdult === "1")) {
    return undefined;
  }

  const originalTitle = emptyToUndefined(row.originalTitle);

  return {
    imdbId: row.tconst,
    type,
    primaryTitle: row.primaryTitle,
    originalTitle,
    startYear: parseNumber(row.startYear),
    endYear: parseNumber(row.endYear),
    runtimeMinutes: parseNumber(row.runtimeMinutes),
    genres: parseList(row.genres),
    normalizedPrimaryTitle: normalizeProviderSearchText(row.primaryTitle),
    normalizedOriginalTitle: normalizeProviderSearchText(originalTitle ?? ""),
  };
}

function createStorageRecord(
  record: IndexedTitleRecord,
  rating: ImdbDatasetRatingRecord | undefined,
): ImdbDatasetTitleRecord {
  return {
    imdbId: record.imdbId,
    type: record.type,
    primaryTitle: record.primaryTitle,
    originalTitle: record.originalTitle,
    startYear: record.startYear,
    endYear: record.endYear,
    runtimeMinutes: record.runtimeMinutes,
    genres: record.genres,
    rating,
  };
}

function parseRatings(tsv: string | undefined): Map<string, ImdbDatasetRatingRecord> {
  const ratings = new Map<string, ImdbDatasetRatingRecord>();

  if (!tsv) {
    return ratings;
  }

  for (const row of parseTsv(tsv)) {
    const rating = parseNumber(row.averageRating);

    if (row.tconst && rating !== undefined) {
      ratings.set(row.tconst, {
        averageRating: rating,
        numVotes: parseNumber(row.numVotes),
      });
    }
  }

  return ratings;
}

function* parseTsv(content: string): Generator<Record<string, string>> {
  const firstLineEnd = content.indexOf("\n");
  const headerLine = (firstLineEnd < 0 ? content : content.slice(0, firstLineEnd)).replace(
    /\r$/,
    "",
  );
  const headers = headerLine.split("\t");
  let offset = firstLineEnd < 0 ? content.length : firstLineEnd + 1;

  while (offset < content.length) {
    const nextLineEnd = content.indexOf("\n", offset);
    const lineEnd = nextLineEnd < 0 ? content.length : nextLineEnd;
    const line = content.slice(offset, lineEnd).replace(/\r$/, "");
    offset = nextLineEnd < 0 ? content.length : nextLineEnd + 1;

    if (!line) {
      continue;
    }

    const values = line.split("\t");
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    yield row;
  }
}

function scoreTitle(record: IndexedTitleRecord, normalizedQuery: string): number {
  const primary = record.normalizedPrimaryTitle;
  const original = record.normalizedOriginalTitle;

  if (primary === normalizedQuery || original === normalizedQuery) {
    return 1;
  }

  if (primary.includes(normalizedQuery) || original.includes(normalizedQuery)) {
    return 0.75;
  }

  return 0;
}

function mapTitleType(titleType: string | undefined): ImdbDatasetTitleRecord["type"] | undefined {
  if (titleType === "movie") {
    return "movie";
  }

  if (titleType === "tvSeries") {
    return "series";
  }

  return undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  const normalized = emptyToUndefined(value);
  return normalized ? normalized.split(",").filter(Boolean) : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  const normalized = emptyToUndefined(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value !== "\\N" ? value : undefined;
}

function compareSearchMatches(
  left: { record: IndexedTitleRecord; confidence: number },
  right: { record: IndexedTitleRecord; confidence: number },
): number {
  return (
    right.confidence - left.confidence ||
    (right.record.startYear ?? 0) - (left.record.startYear ?? 0)
  );
}
