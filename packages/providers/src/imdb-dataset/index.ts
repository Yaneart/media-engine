import type {
  ExternalIds,
  MediaDetails,
  MediaItem,
  MediaProvider,
  MovieDetails,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
  SeriesDetails,
} from "@media-engine/core";
import {
  createImdbDatasetMemoryStorage,
  type ImdbDatasetMemoryStorageOptions,
} from "./memory-storage.js";
import type {
  ImdbDatasetStorage,
  ImdbDatasetStorageSearchResult,
  ImdbDatasetTitleRecord,
} from "./storage.js";
import { mapGenreNames, normalizeProviderSearchText } from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { normalizeProviderOutputUrl } from "../shared/output-url.js";

export { createImdbDatasetMemoryStorage } from "./memory-storage.js";
export type { ImdbDatasetMemoryStorageOptions } from "./memory-storage.js";
export type {
  ImdbDatasetRatingRecord,
  ImdbDatasetStorage,
  ImdbDatasetStorageLookupOptions,
  ImdbDatasetStorageSearchQuery,
  ImdbDatasetStorageSearchResult,
  ImdbDatasetTitleRecord,
} from "./storage.js";

const PROVIDER_NAME = "imdb-dataset";
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

// Options used to create an IMDb dataset provider from official TSV files.
// Опции для создания IMDb dataset provider из официальных TSV-файлов.
export interface ImdbDatasetProviderOptions extends ImdbDatasetMemoryStorageOptions {
  storage?: never;
  version?: string;
  searchLimit?: number;
}

// Options used to connect an indexed IMDb storage implementation.
// Опции для подключения индексированной реализации IMDb storage.
export interface ImdbDatasetStorageProviderOptions {
  storage: ImdbDatasetStorage;
  titleBasicsTsv?: never;
  titleRatingsTsv?: never;
  includeAdult?: never;
  version?: string;
  searchLimit?: number;
}

type ImdbDatasetProviderConfiguration =
  ImdbDatasetProviderOptions | ImdbDatasetStorageProviderOptions;

// Creates a local IMDb dataset provider without live scraping or unofficial APIs.
// Создает локальный IMDb dataset provider без live scraping и неофициальных API.
export function imdbDatasetProvider(options: ImdbDatasetProviderOptions): MediaProvider;
export function imdbDatasetProvider(options: ImdbDatasetStorageProviderOptions): MediaProvider;
export function imdbDatasetProvider(options: ImdbDatasetProviderConfiguration): MediaProvider {
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
      return searchImdbDataset(config, query, context);
    },
    async getDetails(query, context) {
      return getImdbDatasetDetails(config, query, context);
    },
  };
}

interface ImdbDatasetConfig {
  storage: ImdbDatasetStorage;
  searchLimit: number;
}

function createImdbDatasetConfig(options: ImdbDatasetProviderConfiguration): ImdbDatasetConfig {
  const hasStorage = "storage" in options && options.storage !== undefined;
  const hasTsv = "titleBasicsTsv" in options && options.titleBasicsTsv !== undefined;

  if (hasStorage === hasTsv) {
    throw new TypeError("IMDb dataset provider requires exactly one of storage or titleBasicsTsv");
  }

  if (hasStorage && !isImdbDatasetStorage(options.storage)) {
    throw new TypeError("IMDb dataset storage must implement getTitleById and searchTitles");
  }

  const storage = hasStorage
    ? options.storage
    : createImdbDatasetMemoryStorage({
        titleBasicsTsv: options.titleBasicsTsv,
        titleRatingsTsv: options.titleRatingsTsv,
        includeAdult: options.includeAdult,
      });

  return {
    storage,
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "IMDb dataset searchLimit",
      1,
      MAX_SEARCH_LIMIT,
    ),
  };
}

function isImdbDatasetStorage(value: unknown): value is ImdbDatasetStorage {
  return (
    typeof value === "object" &&
    value !== null &&
    "getTitleById" in value &&
    typeof value.getTitleById === "function" &&
    "searchTitles" in value &&
    typeof value.searchTitles === "function"
  );
}

async function searchImdbDataset(
  config: ImdbDatasetConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type === "anime") {
    return [];
  }

  context.signal?.throwIfAborted();

  if (query.ids?.imdb) {
    const record = await config.storage.getTitleById(query.ids.imdb, {
      signal: context.signal,
    });

    context.signal?.throwIfAborted();
    return record && matchesType(record, query.type)
      ? [createSearchResult(record, context.debug, 1)]
      : [];
  }

  const normalizedTitle = normalizeProviderSearchText(query.title ?? "");

  if (!normalizedTitle || query.limit === 0) {
    return [];
  }

  const limit = resolveBoundedIntegerOption(
    query.limit,
    config.searchLimit,
    "IMDb dataset query limit",
    1,
    MAX_SEARCH_LIMIT,
  );
  const matches = await config.storage.searchTitles({
    normalizedTitle,
    type: query.type,
    year: query.year,
    limit,
    signal: context.signal,
  });

  context.signal?.throwIfAborted();

  return matches
    .slice(0, limit)
    .filter((match) => matchesStorageQuery(match, query))
    .map((match) =>
      createSearchResult(match.record, context.debug, normalizeConfidence(match.confidence)),
    );
}

async function getImdbDatasetDetails(
  config: ImdbDatasetConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  const imdbId = query.ids?.imdb;

  if (!imdbId || query.type === "anime") {
    return null;
  }

  context.signal?.throwIfAborted();
  const record = await config.storage.getTitleById(imdbId, { signal: context.signal });
  context.signal?.throwIfAborted();

  if (!record || !matchesType(record, query.type)) {
    return null;
  }

  return {
    provider: PROVIDER_NAME,
    details: recordToDetails(record),
    source: createProviderSource(record),
    raw: context.debug ? record : undefined,
    confidence: 1,
  };
}

function createSearchResult(
  record: ImdbDatasetTitleRecord,
  debug: boolean | undefined,
  confidence: number,
): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item: recordToItem(record),
    source: createProviderSource(record),
    raw: debug ? record : undefined,
    confidence,
  };
}

function recordToItem(record: ImdbDatasetTitleRecord): MediaItem {
  return {
    id: `${PROVIDER_NAME}-${record.imdbId}`,
    type: record.type,
    title: record.primaryTitle,
    originalTitle: record.originalTitle,
    year: record.startYear,
    genres: mapGenreNames(record.genres ? [...record.genres] : undefined, PROVIDER_NAME),
    ratings: mapRating(record.rating),
    ids: createIds(record),
  };
}

function recordToDetails(record: ImdbDatasetTitleRecord): MediaDetails {
  const item = recordToItem(record);
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

function matchesStorageQuery(
  match: ImdbDatasetStorageSearchResult,
  query: ProviderSearchQuery,
): boolean {
  return (
    Number.isFinite(match.confidence) &&
    match.confidence > 0 &&
    matchesType(match.record, query.type) &&
    (query.year === undefined || match.record.startYear === query.year)
  );
}

function matchesType(record: ImdbDatasetTitleRecord, type: ProviderSearchQuery["type"]): boolean {
  return type === undefined || type === record.type;
}

function createIds(record: ImdbDatasetTitleRecord): ExternalIds {
  return {
    imdb: record.imdbId,
  };
}

function createProviderSource(record: ImdbDatasetTitleRecord): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids: createIds(record),
    url: normalizeProviderOutputUrl(`https://www.imdb.com/title/${record.imdbId}/`),
  };
}

function mapRating(rating: ImdbDatasetTitleRecord["rating"]): Rating[] | undefined {
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

function normalizeConfidence(confidence: number): number {
  return Math.min(1, Math.max(0, confidence));
}
