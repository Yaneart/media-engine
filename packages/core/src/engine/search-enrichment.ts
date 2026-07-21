import type { DetailsQuery } from "../details/index.js";
import type { ExternalIds, MediaDetails, MediaItem } from "../media/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { MediaProvider, ProviderRegistry } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import type { ProviderCircuitBreaker } from "./circuit-breaker.js";
import type { ProviderConcurrencyLimiter } from "./concurrency-limiter.js";
import { callTimedProviderSearch, type ProviderSearchCallOutcome } from "./provider-calls.js";
import { hasExternalIds } from "./query.js";
import {
  createSearchDetailsQuery,
  hasSharedExternalId,
  type PlannedIdEnrichment,
  SearchEnrichmentCallBudget,
  supportsSearchEnrichmentFeature,
} from "./search-enrichment-shared.js";
import { loadSearchPoster, type SearchPosterEnrichment } from "./search-poster-enrichment.js";

const SEARCH_ENRICHMENT_MAX_CANDIDATES = 6;
const SEARCH_POSTER_MAX_CANDIDATES = 3;

interface SearchEnrichmentPlannerInput {
  results: MediaSearchResult[];
  publicLimit: number | undefined;
  language: string | undefined;
  excludedProviders: ReadonlySet<string>;
  registry: ProviderRegistry;
  mergeStrategy: MergeStrategy;
  debug: boolean;
  signal?: AbortSignal;
  circuitBreaker?: ProviderCircuitBreaker | undefined;
  concurrencyLimiter?: ProviderConcurrencyLimiter | undefined;
  getProviderTimeoutMs(providerName: string): number | undefined;
  loadReusableDetails(
    query: DetailsQuery,
    signal: AbortSignal | undefined,
    maxWaitMs: number,
  ): Promise<MediaDetails | undefined>;
}

interface SearchEnrichmentPlanResult {
  idOutcomes: ProviderSearchCallOutcome[];
  skippedId: number;
  detailsEnrichments: SearchDetailsEnrichment[];
  posterEnrichments: SearchPosterEnrichment[];
  skippedPoster: number;
}

interface SearchDetailsEnrichment {
  ids: ExternalIds | undefined;
  details: MediaDetails;
}

// Runs one bounded plan for ID and canonical-poster enrichment of the visible top results.
// Выполняет единый bounded plan для ID и canonical-poster enrichment видимых top results.
export async function executeSearchEnrichmentPlan(
  input: SearchEnrichmentPlannerInput,
): Promise<SearchEnrichmentPlanResult> {
  const candidateLimit = Math.min(
    SEARCH_ENRICHMENT_MAX_CANDIDATES,
    input.publicLimit ?? SEARCH_ENRICHMENT_MAX_CANDIDATES,
  );
  const candidates = input.results.slice(0, candidateLimit);
  const posterCandidateLimit = Math.min(SEARCH_POSTER_MAX_CANDIDATES, candidateLimit);
  const budget = new SearchEnrichmentCallBudget(input.getProviderTimeoutMs);
  const idOutcomes: Promise<ProviderSearchCallOutcome>[] = [];
  const detailsEnrichments: SearchDetailsEnrichment[] = [];
  const posterEnrichments: Promise<SearchPosterEnrichment>[] = [];
  let skippedId = 0;

  for (const [index, result] of candidates.entries()) {
    const hasIds = hasExternalIds(result.item.ids);
    const query = hasIds ? createSearchDetailsQuery(result, input.language) : undefined;
    const reusableDetails = query
      ? await input.loadReusableDetails(query, input.signal, budget.getRemainingWallTimeMs())
      : undefined;
    const planningResult = reusableDetails
      ? applyReusableDetailsToResult(result, reusableDetails)
      : result;
    const idEnrichment = planIdEnrichment(input, planningResult, budget);

    if (reusableDetails) {
      detailsEnrichments.push({ ids: result.item.ids, details: reusableDetails });
    }

    if (needsSearchEnrichment(result.item) && hasIds) {
      if (idEnrichment) {
        idOutcomes.push(idEnrichment.outcome);
      } else {
        skippedId += 1;
      }
    }

    if (index >= posterCandidateLimit || !query) {
      continue;
    }

    posterEnrichments.push(
      loadSearchPoster({
        result,
        language: input.language,
        excludedProviders: input.excludedProviders,
        registry: input.registry,
        mergeStrategy: input.mergeStrategy,
        debug: input.debug,
        signal: input.signal,
        circuitBreaker: input.circuitBreaker,
        concurrencyLimiter: input.concurrencyLimiter,
        budget,
        reusableDetails,
        idEnrichment,
      }),
    );
  }

  const [resolvedIdOutcomes, resolvedPosterEnrichments] = await Promise.all([
    Promise.all(idOutcomes),
    Promise.all(posterEnrichments),
  ]);

  return {
    idOutcomes: resolvedIdOutcomes,
    skippedId,
    detailsEnrichments,
    posterEnrichments: resolvedPosterEnrichments,
    skippedPoster: resolvedPosterEnrichments.reduce(
      (total, enrichment) => total + enrichment.skipped,
      0,
    ),
  };
}

// Enriches compact catalog hits only when a provider advertises a useful missing field.
// Обогащает compact catalog hits, только если provider заявляет полезное отсутствующее поле.
export function needsSearchEnrichment(item: {
  ratings?: unknown[];
  description?: string;
  poster?: unknown;
}): boolean {
  return !item.ratings?.length || !item.description?.trim() || !item.poster;
}

function planIdEnrichment(
  input: SearchEnrichmentPlannerInput,
  result: MediaSearchResult,
  budget: SearchEnrichmentCallBudget,
): PlannedIdEnrichment | undefined {
  if (!needsSearchEnrichment(result.item) || !hasExternalIds(result.item.ids)) {
    return undefined;
  }

  const existingProviders = new Set(result.sources.map((source) => source.provider));
  const enrichmentType = result.item.type === "anime" ? undefined : result.item.type;
  const providers = input.registry
    .selectSearchProviders({ ids: result.item.ids, type: enrichmentType })
    .filter((candidate) => !existingProviders.has(candidate.name))
    .map((candidate, index) => ({
      candidate,
      index,
      score: getMissingFieldImprovementScore(candidate, result.item),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate);

  for (const provider of providers) {
    const timeoutMs = budget.reserve(provider.name);

    if (timeoutMs === undefined) {
      continue;
    }

    return {
      provider,
      outcome: callTimedProviderSearch(
        provider,
        {
          ids: result.item.ids,
          type: enrichmentType,
          limit: 1,
          language: input.language,
        },
        {
          debug: input.debug,
          language: input.language,
          signal: input.signal,
          timeoutMs,
          circuitBreaker: input.circuitBreaker,
          concurrencyLimiter: input.concurrencyLimiter,
        },
      ),
    };
  }

  return undefined;
}

function getMissingFieldImprovementScore(provider: MediaProvider, item: MediaItem): number {
  let score = 0;

  if (!item.description?.trim()) {
    score += 1;
  }

  if (!item.poster && supportsSearchEnrichmentFeature(provider, "posters")) {
    score += 1;
  }

  if (!item.ratings?.length && supportsSearchEnrichmentFeature(provider, "ratings")) {
    score += 1;
  }

  return score;
}

// Reuses compact fields from a matching cached/in-flight details operation.
// Переиспользует compact-поля совпадающей cached/in-flight details operation.
export function applySearchDetailsEnrichments(
  results: MediaSearchResult[],
  enrichments: SearchDetailsEnrichment[],
): MediaSearchResult[] {
  return results.map((result) => {
    const details = enrichments.find((enrichment) =>
      hasSharedExternalId(result.item.ids, enrichment.ids),
    )?.details;

    return details ? applyReusableDetailsToResult(result, details) : result;
  });
}

function applyReusableDetailsToResult(
  result: MediaSearchResult,
  details: MediaDetails,
): MediaSearchResult {
  return {
    ...result,
    item: {
      ...result.item,
      description: result.item.description?.trim() ? result.item.description : details.description,
      poster: details.poster ?? result.item.poster,
      ratings: result.item.ratings?.length ? result.item.ratings : details.ratings,
    },
  };
}
