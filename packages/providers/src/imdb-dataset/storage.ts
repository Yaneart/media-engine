// One normalized IMDb rating stored beside a title record.
// Один нормализованный IMDb rating, хранящийся вместе с title record.
export interface ImdbDatasetRatingRecord {
  readonly averageRating: number;
  readonly numVotes?: number;
}

// Storage-neutral title record consumed by the IMDb dataset provider.
// Независимая от storage запись title, используемая IMDb dataset provider.
export interface ImdbDatasetTitleRecord {
  readonly imdbId: string;
  readonly type: "movie" | "series";
  readonly primaryTitle: string;
  readonly originalTitle?: string;
  readonly startYear?: number;
  readonly endYear?: number;
  readonly runtimeMinutes?: number;
  readonly genres?: readonly string[];
  readonly rating?: ImdbDatasetRatingRecord;
}

// Optional controls for a direct IMDb ID lookup.
// Опциональные параметры прямого поиска по IMDb ID.
export interface ImdbDatasetStorageLookupOptions {
  readonly signal?: AbortSignal;
}

// Normalized and bounded title query passed to an IMDb storage backend.
// Нормализованный и ограниченный title query для IMDb storage backend.
export interface ImdbDatasetStorageSearchQuery {
  readonly normalizedTitle: string;
  readonly type?: "movie" | "series";
  readonly year?: number;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

// One ranked storage match. Confidence must be finite and in the (0, 1] range.
// Один ранжированный storage match. Confidence должен быть конечным и входить в (0, 1].
export interface ImdbDatasetStorageSearchResult {
  readonly record: ImdbDatasetTitleRecord;
  readonly confidence: number;
}

// Pluggable contract for persistent or application-owned IMDb indexes.
// Подключаемый контракт для постоянных или управляемых приложением IMDb-индексов.
export interface ImdbDatasetStorage {
  // Implementations should provide an indexed O(1), or storage-native equivalent, ID lookup.
  // Реализация должна обеспечивать индексированный O(1) либо storage-native эквивалентный ID lookup.
  getTitleById(
    imdbId: string,
    options?: ImdbDatasetStorageLookupOptions,
  ): ImdbDatasetTitleRecord | undefined | Promise<ImdbDatasetTitleRecord | undefined>;

  // Return no more than query.limit valid matches, ordered from strongest to weakest.
  // Возвращает не больше query.limit валидных совпадений от сильнейшего к слабейшему.
  searchTitles(
    query: ImdbDatasetStorageSearchQuery,
  ): readonly ImdbDatasetStorageSearchResult[] | Promise<readonly ImdbDatasetStorageSearchResult[]>;
}
