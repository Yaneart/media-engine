import type { ProviderSearchResult } from "../providers/index.js";
import type { ProviderFailure, ProviderTimingMeta } from "../response/index.js";
import type { ProviderSearchCallOutcome } from "./provider-calls.js";
import { appendUniqueSearchResults } from "./query.js";

// Mutable search execution state shared by primary and mandatory fallback calls.
// Изменяемое состояние search-вызовов, общее для primary и обязательной fallback-фазы.
export interface SearchOutcomeAccumulator {
  successful: string[];
  failed: ProviderFailure[];
  results: ProviderSearchResult[];
  timings: ProviderTimingMeta[];
}

// Adds provider outcomes to response metadata and the raw merge input.
// Добавляет результаты провайдеров в response metadata и исходные данные для merge.
export function appendSearchCallOutcomes(
  accumulator: SearchOutcomeAccumulator,
  outcomes: ProviderSearchCallOutcome[],
  options: { deduplicateResults?: boolean } = {},
): void {
  for (const outcome of outcomes) {
    accumulator.timings.push(outcome.timing);

    if (outcome.failure) {
      accumulator.failed.push(outcome.failure);
      continue;
    }

    if (!accumulator.successful.includes(outcome.provider)) {
      accumulator.successful.push(outcome.provider);
    }

    if (options.deduplicateResults) {
      appendUniqueSearchResults(accumulator.results, outcome.results);
    } else {
      accumulator.results.push(...outcome.results);
    }
  }
}
