import type { DetailsQuery } from "../details/index.js";
import type { ExternalIds, Image, MediaDetails, MediaItem } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { ProviderRegistry, ProviderDetailsResult } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import type { ProviderCircuitBreaker } from "./circuit-breaker.js";
import type { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import { callTimedProviderDetails } from "./provider-calls.js";
import { EXTERNAL_ID_SHORTCUTS, hasExternalIds } from "./query.js";

const SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS = 1_500;

export interface SearchPosterLookupInput {
  result: MediaSearchResult;
  language: string | undefined;
  excludedProviders: ReadonlySet<string>;
  registry: ProviderRegistry;
  mergeStrategy: MergeStrategy;
  debug: boolean;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  concurrencyLimiter?: ProviderConcurrencyLimiter | undefined;
  getProviderTimeoutMs(providerName: string): number | undefined;
}

export interface SearchPosterEnrichment {
  ids: ExternalIds | undefined;
  poster: Image | undefined;
}

// Enriches compact catalog hits when follow-up cards would otherwise choose different metadata.
// Обогащает compact catalog hits, чтобы search и details не выбирали разные metadata.
export function needsSearchEnrichment(item: {
  ratings?: unknown[];
  description?: string;
  poster?: unknown;
}): boolean {
  return !item.ratings?.length || !item.description?.trim() || !item.poster;
}

// Loads only the canonical poster needed by search without blocking on a full details request.
// Загружает только канонический постер для search, не блокируя полный details-запрос.
export async function loadSearchPoster(input: SearchPosterLookupInput): Promise<Image | undefined> {
  if (!hasExternalIds(input.result.item.ids)) {
    return undefined;
  }

  const query: DetailsQuery = {
    type: input.result.item.type,
    ids: input.result.item.ids,
    language: input.language,
  };
  const searchProviders = new Set(input.result.sources.map((source) => source.provider));
  const providers = input.registry
    .selectDetailsProviders(query)
    .filter((provider) => !input.excludedProviders.has(provider.name));
  const reusablePosterProvider = providers.find(
    (provider) =>
      provider.searchPosterMatchesDetails === true &&
      provider.name === input.result.item.poster?.source &&
      searchProviders.has(provider.name),
  );
  const providersToLoad = reusablePosterProvider
    ? providers.filter(
        (provider) =>
          provider.searchPosterMatchesDetails !== true || !searchProviders.has(provider.name),
      )
    : providers;
  const outcomes = await Promise.all(
    providersToLoad.map((provider) => {
      const providerTimeoutMs = input.getProviderTimeoutMs(provider.name);
      return callTimedProviderDetails(provider, query, {
        debug: input.debug,
        language: input.language,
        circuitBreaker: input.circuitBreaker,
        concurrencyLimiter: input.concurrencyLimiter,
        timeoutMs:
          providerTimeoutMs === undefined
            ? SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS
            : Math.min(providerTimeoutMs, SEARCH_DETAILS_POSTER_ENRICHMENT_TIMEOUT_MS),
      });
    }),
  );
  const loadedResults = new Map(
    outcomes.flatMap((outcome) =>
      outcome.failure || !outcome.result ? [] : [[outcome.provider, outcome.result] as const],
    ),
  );
  const providerResults: ProviderDetailsResult[] = providers.flatMap((provider) => {
    if (provider.name === reusablePosterProvider?.name) {
      return [
        {
          provider: reusablePosterProvider.name,
          details: searchItemAsDetails(input.result.item),
        },
      ];
    }

    const loaded = loadedResults.get(provider.name);
    return loaded ? [loaded] : [];
  });

  return input.mergeStrategy.mergeDetails(providerResults, {
    query,
    language: input.language,
    debug: input.debug,
    warnings: [],
  })?.poster;
}

// Reuses only compact fields; every details-only field remains absent by construction.
// Переиспользует только compact-поля; details-only поля намеренно остаются пустыми.
function searchItemAsDetails(item: MediaItem): MediaDetails {
  switch (item.type) {
    case "movie":
      return { ...item, type: "movie" };
    case "series":
      return { ...item, type: "series" };
    case "anime":
      return { ...item, type: "anime" };
  }
}

// Applies canonical poster enrichments to matching search results.
// Применяет canonical poster enrichment к совпадающим search results.
export function applySearchPosterEnrichments(
  results: MediaSearchResult[],
  enrichments: SearchPosterEnrichment[],
): MediaSearchResult[] {
  return results.map((result) => {
    const poster = enrichments.find(
      (enrichment) => enrichment.poster && hasSharedExternalId(result.item.ids, enrichment.ids),
    )?.poster;
    return poster ? { ...result, item: { ...result.item, poster } } : result;
  });
}

// Checks whether two normalized media identities share at least one exact external ID.
// Проверяет, совпадает ли у двух нормализованных media identity хотя бы один внешний ID.
function hasSharedExternalId(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return EXTERNAL_ID_SHORTCUTS.some((key) => Boolean(left[key] && left[key] === right[key]));
}
