import type {
  ExternalIds,
  MediaDetails,
  MediaItem,
  MediaType,
  ProviderSource,
} from "../media/index.js";

// Provider category supported by the core metadata contract.
// Категория провайдера, поддерживаемая core-контрактом метаданных.
export type ProviderKind = "metadata";

// External ID source names supported by provider capabilities.
// Имена источников внешних ID, поддерживаемые возможностями провайдера.
export type ExternalIdSource =
  "imdb" | "tmdb" | "kinopoisk" | "shikimori" | "myAnimeList" | "aniList" | "worldArt";

// Optional data features that a provider can return.
// Опциональные возможности данных, которые может возвращать провайдер.
export type ProviderFeature =
  | "posters"
  | "backdrops"
  | "ratings"
  | "genres"
  | "persons"
  | "seasons"
  | "episodes"
  | "alternative_titles";

// Capabilities used by the engine to select matching providers.
// Возможности, по которым движок выбирает подходящих провайдеров.
export interface ProviderCapabilities {
  mediaTypes: MediaType[];
  search: {
    byTitle: boolean;
    byExternalIds: ExternalIdSource[];
  };
  details: {
    byExternalIds: ExternalIdSource[];
  };
  features?: ProviderFeature[];
}

// Request-specific context passed into provider methods.
// Контекст конкретного запроса, передаваемый в методы провайдера.
export interface ProviderContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  debug?: boolean;
  language?: string;
}

// Normalized provider-facing query for search calls.
// Нормализованный запрос для вызовов поиска на стороне провайдера.
export interface ProviderSearchQuery {
  title?: string;
  type?: MediaType;
  year?: number;
  ids?: ExternalIds;
  limit?: number;
  language?: string;
}

// Normalized provider-facing query for details calls.
// Нормализованный запрос для вызовов деталей на стороне провайдера.
export interface ProviderDetailsQuery {
  id?: string;
  ids?: ExternalIds;
  type?: MediaType;
  language?: string;
}

// Raw search result returned by a single provider before merging.
// Сырой результат поиска от одного провайдера до объединения.
export interface ProviderSearchResult {
  provider: string;
  item: MediaItem;
  confidence?: number;
  source?: ProviderSource;
  raw?: unknown;
}

// Raw details result returned by a single provider before merging.
// Сырой результат деталей от одного провайдера до объединения.
export interface ProviderDetailsResult {
  provider: string;
  details: MediaDetails;
  confidence?: number;
  source?: ProviderSource;
  raw?: unknown;
}

// Safe provider metadata exposed by public APIs.
// Безопасные метаданные провайдера для публичных API.
export interface ProviderInfo {
  name: string;
  version?: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
}

// Metadata provider contract implemented outside of core.
// Контракт metadata-провайдера, реализуемый вне core.
export interface MediaProvider {
  name: string;
  version?: string;
  kind: "metadata";
  capabilities: ProviderCapabilities;
  // Opt-in guarantee used to reuse a returned search poster during details-poster enrichment.
  // Opt-in гарантия для переиспользования search poster при обогащении poster из details.
  searchPosterMatchesDetails?: boolean;

  search(query: ProviderSearchQuery, context: ProviderContext): Promise<ProviderSearchResult[]>;

  getDetails?(
    query: ProviderDetailsQuery,
    context: ProviderContext,
  ): Promise<ProviderDetailsResult | null>;
}
