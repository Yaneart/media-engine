import type {
  ExternalIds,
  MediaDetails,
  MediaItem,
  MovieDetails,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
  SeriesDetails,
} from "@media-engine/core";
import {
  mapGenreNames,
  normalizeProviderSearchText as normalizeSearchText,
} from "../shared/mapping.js";
import { normalizeProviderOutputUrl } from "../shared/output-url.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { type MediaProvider } from "@media-engine/core";

const PROVIDER_NAME = "imdb-dataset";
const DEFAULT_SEARCH_LIMIT = 20;

// Options used to create an IMDb dataset provider from official TSV files.
// Опции для создания IMDb dataset provider из официальных TSV-файлов.
export interface ImdbDatasetProviderOptions {
  titleBasicsTsv: string;
  titleRatingsTsv?: string;
  includeAdult?: boolean;
  version?: string;
  searchLimit?: number;
}

// Creates a local IMDb dataset provider without live scraping or unofficial APIs.
// Создает локальный IMDb dataset provider без live scraping и неофициальных API.
export function imdbDatasetProvider(options: ImdbDatasetProviderOptions): MediaProvider {
  const config = createImdbDatasetConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie", "series"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
      features: ["ratings", "genres"],
    },
    async search(query, context) {
      return searchImdbDataset(config, query, context.debug);
    },
    async getDetails(query, context) {
      return getImdbDatasetDetails(config, query, context.debug);
    },
  };
}

// Internal normalized IMDb dataset configuration and indexes.
// Внутренняя нормализованная конфигурация и индексы IMDb dataset.
interface ImdbDatasetConfig {
  recordsById: Map<string, ImdbTitleRecord>;
  ratingsById: Map<string, ImdbRatingRecord>;
  searchLimit: number;
}

interface ImdbTitleRecord {
  tconst: string;
  type: "movie" | "series";
  primaryTitle: string;
  originalTitle?: string;
  startYear?: number;
  endYear?: number;
  runtimeMinutes?: number;
  genres?: string[];
  normalizedPrimaryTitle: string;
  normalizedOriginalTitle: string;
}

interface ImdbRatingRecord {
  averageRating: number;
  numVotes?: number;
}

// Parses TSV content and builds lookup maps once at provider creation time.
// Парсит TSV content и строит lookup maps один раз при создании provider.
function createImdbDatasetConfig(options: ImdbDatasetProviderOptions): ImdbDatasetConfig {
  const recordsById = new Map<string, ImdbTitleRecord>();

  for (const row of parseTsv(options.titleBasicsTsv)) {
    const record = mapTitleBasicsRow(row, options.includeAdult ?? false);

    if (record) {
      recordsById.set(record.tconst, record);
    }
  }

  return {
    recordsById,
    ratingsById: parseRatings(options.titleRatingsTsv),
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "IMDb dataset searchLimit",
      1,
      100,
    ),
  };
}

// Runs local title or IMDb ID search over parsed IMDb title records.
// Выполняет локальный поиск по названию или IMDb ID по распарсенным title records.
function searchImdbDataset(
  config: ImdbDatasetConfig,
  query: ProviderSearchQuery,
  debug: boolean | undefined,
): ProviderSearchResult[] {
  if (query.type === "anime") {
    return [];
  }

  if (query.ids?.imdb) {
    const record = config.recordsById.get(query.ids.imdb);
    return record && matchesType(record, query.type)
      ? [createSearchResult(config, record, debug, 1)]
      : [];
  }

  const normalizedTitle = normalizeSearchText(query.title ?? "");

  if (!normalizedTitle) {
    return [];
  }

  const limit = query.limit ?? config.searchLimit;
  const matches: Array<{ record: ImdbTitleRecord; score: number }> = [];

  for (const record of config.recordsById.values()) {
    if (
      !matchesType(record, query.type) ||
      (query.year !== undefined && record.startYear !== query.year)
    ) {
      continue;
    }

    const score = scoreTitle(record, normalizedTitle);

    if (score <= 0) {
      continue;
    }

    const candidate = { record, score };
    const worstMatch = matches.at(-1);

    if (matches.length >= limit && worstMatch && compareSearchMatches(candidate, worstMatch) >= 0) {
      continue;
    }

    matches.push(candidate);
    matches.sort(compareSearchMatches);

    if (matches.length > limit) {
      matches.pop();
    }
  }

  return matches.map((entry) => createSearchResult(config, entry.record, debug, entry.score));
}

// Loads local details by IMDb title ID.
// Загружает локальные details по IMDb title ID.
function getImdbDatasetDetails(
  config: ImdbDatasetConfig,
  query: ProviderDetailsQuery,
  debug: boolean | undefined,
): ProviderDetailsResult | null {
  const imdbId = query.ids?.imdb;

  if (!imdbId || query.type === "anime") {
    return null;
  }

  const record = config.recordsById.get(imdbId);

  if (!record || !matchesType(record, query.type)) {
    return null;
  }

  const details = recordToDetails(config, record);

  return {
    provider: PROVIDER_NAME,
    details,
    source: createProviderSource(record),
    raw: debug ? record : undefined,
    confidence: 1,
  };
}

// Converts one IMDb title row into a provider search result.
// Преобразует одну IMDb title row в provider search result.
function createSearchResult(
  config: ImdbDatasetConfig,
  record: ImdbTitleRecord,
  debug: boolean | undefined,
  confidence: number,
): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item: recordToItem(config, record),
    source: createProviderSource(record),
    raw: debug ? record : undefined,
    confidence,
  };
}

// Converts an IMDb title record into a compact MediaItem.
// Преобразует IMDb title record в compact MediaItem.
function recordToItem(config: ImdbDatasetConfig, record: ImdbTitleRecord): MediaItem {
  return {
    id: `${PROVIDER_NAME}-${record.tconst}`,
    type: record.type,
    title: record.primaryTitle,
    originalTitle: record.originalTitle,
    year: record.startYear,
    genres: mapGenreNames(record.genres, PROVIDER_NAME),
    ratings: mapRating(config.ratingsById.get(record.tconst)),
    ids: createIds(record),
  };
}

// Converts an IMDb title record into basic movie or series details.
// Преобразует IMDb title record в базовые details фильма или сериала.
function recordToDetails(config: ImdbDatasetConfig, record: ImdbTitleRecord): MediaDetails {
  const item = recordToItem(config, record);
  const sourceProviders = [createProviderSource(record)];

  if (record.type === "series") {
    const details: SeriesDetails = {
      ...item,
      type: "series",
      runtimeMinutes: record.runtimeMinutes,
      sourceProviders,
    };

    return details;
  }

  const details: MovieDetails = {
    ...item,
    type: "movie",
    runtimeMinutes: record.runtimeMinutes,
    sourceProviders,
  };

  return details;
}

// Maps IMDb TSV title.basics rows into normalized title records.
// Мапит IMDb TSV title.basics rows в нормализованные title records.
function mapTitleBasicsRow(
  row: Record<string, string>,
  includeAdult: boolean,
): ImdbTitleRecord | undefined {
  const type = mapTitleType(row.titleType);

  if (!type || (!includeAdult && row.isAdult === "1")) {
    return undefined;
  }

  const originalTitle = emptyToUndefined(row.originalTitle);

  return {
    tconst: row.tconst,
    type,
    primaryTitle: row.primaryTitle,
    originalTitle,
    startYear: parseNumber(row.startYear),
    endYear: parseNumber(row.endYear),
    runtimeMinutes: parseNumber(row.runtimeMinutes),
    genres: parseList(row.genres),
    normalizedPrimaryTitle: normalizeSearchText(row.primaryTitle),
    normalizedOriginalTitle: normalizeSearchText(originalTitle ?? ""),
  };
}

// Parses optional IMDb title.ratings TSV content.
// Парсит опциональный IMDb title.ratings TSV content.
function parseRatings(tsv: string | undefined): Map<string, ImdbRatingRecord> {
  const ratings = new Map<string, ImdbRatingRecord>();

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

// Parses TSV content into rows keyed by header names.
// Парсит TSV content в rows с ключами из header names.
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

// Maps IMDb titleType into Media Engine type.
// Мапит IMDb titleType в тип Media Engine.
function mapTitleType(titleType: string | undefined): ImdbTitleRecord["type"] | undefined {
  if (titleType === "movie") {
    return "movie";
  }

  if (titleType === "tvSeries") {
    return "series";
  }

  return undefined;
}

// Creates normalized IMDb external IDs.
// Создает нормализованные IMDb external IDs.
function createIds(record: ImdbTitleRecord): ExternalIds {
  return {
    imdb: record.tconst,
  };
}

// Creates source attribution for IMDb dataset records.
// Создает source attribution для IMDb dataset records.
function createProviderSource(record: ImdbTitleRecord): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids: createIds(record),
    url: normalizeProviderOutputUrl(`https://www.imdb.com/title/${record.tconst}/`),
  };
}

// Maps IMDb rating row into normalized rating.
// Мапит IMDb rating row в нормализованный rating.
function mapRating(rating: ImdbRatingRecord | undefined): Rating[] | undefined {
  return rating
    ? [
        {
          source: "imdb",
          value: rating.averageRating,
          max: 10,
          votes: rating.numVotes,
        },
      ]
    : undefined;
}

// Scores a record title against a normalized search query.
// Оценивает record title относительно нормализованного search query.
function scoreTitle(record: ImdbTitleRecord, normalizedQuery: string): number {
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

function matchesType(record: ImdbTitleRecord, type: ProviderSearchQuery["type"]): boolean {
  return type === undefined || type === record.type;
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

function compareNumbers(left: number | undefined, right: number | undefined): number {
  return (right ?? 0) - (left ?? 0);
}

function compareSearchMatches(
  left: { record: ImdbTitleRecord; score: number },
  right: { record: ImdbTitleRecord; score: number },
): number {
  return right.score - left.score || compareNumbers(left.record.startYear, right.record.startYear);
}
