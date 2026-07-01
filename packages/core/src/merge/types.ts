import type { DetailsQuery } from "../details/index.js";
import type { MediaDetails } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning } from "../response/index.js";
import type { MediaSearchResult, SearchQuery } from "../search/index.js";

// Match quality assigned by the merge strategy.
// Качество совпадения, которое назначает стратегия объединения.
export type MatchStrength =
  | "exact_id"
  | "exact_title_year_type"
  | "normalized_title_year_type"
  | "weak"
  | "none";

// Context that tunes merge behavior for one engine operation.
// Контекст, который настраивает объединение для одной операции движка.
export interface MergeContext {
  query?: SearchQuery | DetailsQuery;
  language?: string;
  providerPriority?: string[];
  debug?: boolean;
  warnings?: EngineWarning[];
}

// Contract implemented by search and details merge strategies.
// Контракт для стратегий объединения поиска и деталей.
export interface MergeStrategy {
  mergeSearchResults(results: ProviderSearchResult[], context: MergeContext): MediaSearchResult[];

  mergeDetails(results: ProviderDetailsResult[], context: MergeContext): MediaDetails | null;
}
