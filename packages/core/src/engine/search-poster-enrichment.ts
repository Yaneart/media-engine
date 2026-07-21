import type { DetailsQuery } from "../details/index.js";
import type { ExternalIds, Image, MediaDetails } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { MediaProvider, ProviderDetailsResult, ProviderRegistry } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import type { ProviderCircuitBreaker } from "./circuit-breaker.js";
import type { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import { callTimedProviderDetails, type ProviderDetailsCallOutcome } from "./provider-calls.js";
import {
  createSearchDetailsQuery,
  hasSharedExternalId,
  type PlannedIdEnrichment,
  type SearchEnrichmentCallBudget,
  searchItemAsDetails,
  supportsSearchEnrichmentFeature,
} from "./search-enrichment-shared.js";

export interface SearchPosterEnrichment {
  ids: ExternalIds | undefined;
  poster: Image | undefined;
  outcomes: ProviderDetailsCallOutcome[];
  skipped: number;
}

interface SearchPosterLookupInput {
  result: MediaSearchResult;
  language: string | undefined;
  excludedProviders: ReadonlySet<string>;
  registry: ProviderRegistry;
  mergeStrategy: MergeStrategy;
  debug: boolean;
  signal?: AbortSignal;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  concurrencyLimiter?: ProviderConcurrencyLimiter | undefined;
  budget: SearchEnrichmentCallBudget;
  reusableDetails?: MediaDetails;
  idEnrichment?: PlannedIdEnrichment;
}

// Loads the best canonical poster while sharing matching ID-search work from the same plan.
// Загружает лучший canonical poster, переиспользуя совпадающий ID-search того же plan.
export async function loadSearchPoster(
  input: SearchPosterLookupInput,
): Promise<SearchPosterEnrichment> {
  const query = createSearchDetailsQuery(input.result, input.language);
  const selectedProviders = input.registry.selectDetailsProviders(query);
  const providers = selectedProviders.filter(
    (provider) =>
      !input.excludedProviders.has(provider.name) &&
      supportsSearchEnrichmentFeature(provider, "posters"),
  );

  if (input.reusableDetails?.poster) {
    return {
      ids: input.result.item.ids,
      poster: input.reusableDetails.poster,
      outcomes: [],
      skipped: selectedProviders.length,
    };
  }

  const searchProviders = new Set(input.result.sources.map((source) => source.provider));
  const reusableSearchProviders = new Set(
    providers
      .filter(
        (provider) =>
          provider.searchPosterMatchesDetails === true && searchProviders.has(provider.name),
      )
      .map((provider) => provider.name),
  );
  const reusablePosterProvider = providers.find(
    (provider) =>
      reusableSearchProviders.has(provider.name) &&
      provider.name === input.result.item.poster?.source &&
      input.result.item.poster,
  );
  const loads = await Promise.all(
    providers.map((provider) =>
      loadPosterProviderResult(
        provider,
        query,
        input,
        reusableSearchProviders,
        reusablePosterProvider,
      ),
    ),
  );
  const outcomes = loads.flatMap((load) => (load.outcome ? [load.outcome] : []));
  const providerResults = loads.flatMap((load) => (load.result ? [load.result] : []));

  return {
    ids: input.result.item.ids,
    poster: input.mergeStrategy.mergeDetails(providerResults, {
      query,
      language: input.language,
      debug: input.debug,
      warnings: [],
    })?.poster,
    outcomes,
    skipped: selectedProviders.length - outcomes.length,
  };
}

async function loadPosterProviderResult(
  provider: MediaProvider,
  query: DetailsQuery,
  input: SearchPosterLookupInput,
  reusableSearchProviders: ReadonlySet<string>,
  reusablePosterProvider: MediaProvider | undefined,
): Promise<{ outcome?: ProviderDetailsCallOutcome; result?: ProviderDetailsResult }> {
  if (provider.name === reusablePosterProvider?.name) {
    return {
      result: {
        provider: provider.name,
        details: searchItemAsDetails(input.result.item),
      },
    };
  }

  if (reusableSearchProviders.has(provider.name)) {
    return {};
  }

  if (
    provider.searchPosterMatchesDetails === true &&
    provider.name === input.idEnrichment?.provider.name
  ) {
    const outcome = await input.idEnrichment.outcome;
    const reusableResult = outcome.failure
      ? undefined
      : outcome.results.find(
          (result) => result.item.poster && hasSharedExternalId(result.item.ids, query.ids),
        );

    if (reusableResult) {
      return {
        result: {
          provider: provider.name,
          details: searchItemAsDetails(reusableResult.item),
        },
      };
    }
  }

  const timeoutMs = input.budget.reserve(provider.name);

  if (timeoutMs === undefined) {
    return {};
  }

  const outcome = await callTimedProviderDetails(provider, query, {
    debug: input.debug,
    language: input.language,
    signal: input.signal,
    circuitBreaker: input.circuitBreaker,
    concurrencyLimiter: input.concurrencyLimiter,
    timeoutMs,
  });

  return {
    outcome,
    result: outcome.failure || !outcome.result ? undefined : outcome.result,
  };
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
