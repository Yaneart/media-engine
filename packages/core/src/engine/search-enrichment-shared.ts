import type { DetailsQuery } from "../details/index.js";
import type { ExternalIds, MediaDetails, MediaItem } from "../media/index.js";
import type { MediaProvider } from "../providers/index.js";
import type { MediaSearchResult } from "../search/index.js";
import type { ProviderSearchCallOutcome } from "./provider-calls.js";
import { EXTERNAL_ID_SHORTCUTS } from "./query.js";

const SEARCH_ENRICHMENT_MAX_ADDITIONAL_CALLS = 6;
const SEARCH_ENRICHMENT_MAX_CALLS_PER_PROVIDER = 2;
const SEARCH_ENRICHMENT_MAX_WALL_TIME_MS = 1_500;

export interface PlannedIdEnrichment {
  provider: MediaProvider;
  outcome: Promise<ProviderSearchCallOutcome>;
}

export function supportsSearchEnrichmentFeature(
  provider: MediaProvider,
  feature: "posters" | "ratings",
): boolean {
  return provider.capabilities.features?.includes(feature) ?? true;
}

export function createSearchDetailsQuery(
  result: MediaSearchResult,
  language: string | undefined,
): DetailsQuery {
  return {
    type: result.item.type,
    ids: result.item.ids,
    language,
  };
}

// Reuses only compact fields; every details-only field remains absent by construction.
// Переиспользует только compact-поля; details-only поля намеренно остаются пустыми.
export function searchItemAsDetails(item: MediaItem): MediaDetails {
  switch (item.type) {
    case "movie":
      return { ...item, type: "movie" };
    case "series":
      return { ...item, type: "series" };
    case "anime":
      return { ...item, type: "anime" };
  }
}

// Checks whether two normalized media identities share at least one exact external ID.
// Проверяет, совпадает ли у двух нормализованных media identity хотя бы один внешний ID.
export function hasSharedExternalId(
  left: ExternalIds | undefined,
  right: ExternalIds | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return EXTERNAL_ID_SHORTCUTS.some((key) => Boolean(left[key] && left[key] === right[key]));
}

export class SearchEnrichmentCallBudget {
  private readonly startedAt = Date.now();
  private readonly providerCalls = new Map<string, number>();
  private calls = 0;

  constructor(
    private readonly getProviderTimeoutMs: (providerName: string) => number | undefined,
  ) {}

  getRemainingWallTimeMs(): number {
    return Math.max(0, SEARCH_ENRICHMENT_MAX_WALL_TIME_MS - (Date.now() - this.startedAt));
  }

  reserve(providerName: string): number | undefined {
    const providerCalls = this.providerCalls.get(providerName) ?? 0;

    if (
      this.calls >= SEARCH_ENRICHMENT_MAX_ADDITIONAL_CALLS ||
      providerCalls >= SEARCH_ENRICHMENT_MAX_CALLS_PER_PROVIDER
    ) {
      return undefined;
    }

    const remainingWallTimeMs = this.getRemainingWallTimeMs();
    const remainingProviderTimeMs = this.getProviderTimeoutMs(providerName);
    const timeoutMs =
      remainingProviderTimeMs === undefined
        ? remainingWallTimeMs
        : Math.min(remainingWallTimeMs, remainingProviderTimeMs);

    if (timeoutMs <= 0) {
      return undefined;
    }

    this.calls += 1;
    this.providerCalls.set(providerName, providerCalls + 1);
    return timeoutMs;
  }
}
