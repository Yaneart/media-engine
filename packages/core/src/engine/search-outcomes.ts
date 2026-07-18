import type { ProviderSearchResult } from "../providers/index.js";
import type {
  EngineWarning,
  ProviderExecutionPhase,
  ProviderFailure,
  ProviderTimingMeta,
  SearchEnrichmentCounters,
  SearchEnrichmentDebugMeta,
} from "../response/index.js";
import type { ProviderDetailsCallOutcome, ProviderSearchCallOutcome } from "./provider-calls.js";
import { appendUniqueSearchResults } from "./query.js";

type MandatorySearchPhase = "primary" | "retry" | "fallback";
type EnrichmentSearchPhase = "id_enrichment" | "poster_enrichment";
type EnrichmentOutcome = ProviderSearchCallOutcome | ProviderDetailsCallOutcome;

const ID_ENRICHMENT_WARNING = "SEARCH_ID_ENRICHMENT_FAILED";
const POSTER_ENRICHMENT_WARNING = "SEARCH_POSTER_ENRICHMENT_FAILED";

// Owns phase-aware search execution state and keeps public provider summaries deduplicated.
// Хранит phase-aware состояние search и не допускает дублей в публичной сводке провайдеров.
export class SearchOutcomeAccumulator {
  readonly successful: string[];
  readonly failed: ProviderFailure[];
  readonly results: ProviderSearchResult[];
  readonly timings: ProviderTimingMeta[];
  readonly warnings: EngineWarning[];

  private readonly retryableMandatoryFailures = new Set<string>();
  private readonly enrichment: SearchEnrichmentDebugMeta = {
    id: createCounters(),
    poster: createCounters(),
  };

  constructor(input: {
    successful: string[];
    failed: ProviderFailure[];
    results: ProviderSearchResult[];
    timings: ProviderTimingMeta[];
    warnings: EngineWarning[];
  }) {
    this.successful = input.successful;
    this.failed = input.failed;
    this.results = input.results;
    this.timings = input.timings;
    this.warnings = input.warnings;
  }

  // Adds mandatory provider work and applies retry recovery to the public failure summary.
  // Добавляет обязательную provider-работу и учитывает успешное retry-восстановление.
  appendMandatory(
    outcomes: ProviderSearchCallOutcome[],
    phase: MandatorySearchPhase,
    options: { deduplicateResults?: boolean } = {},
  ): void {
    for (const outcome of outcomes) {
      this.timings.push(withPhase(outcome.timing, phase));

      if (outcome.failure) {
        this.upsertFailure(outcome.failure, phase);

        if (outcome.failure.retryable) {
          this.retryableMandatoryFailures.add(outcome.provider);
        }
        continue;
      }

      if (phase === "retry") {
        this.removeFailure(outcome.provider);
        this.retryableMandatoryFailures.delete(outcome.provider);
      }

      if (!this.successful.includes(outcome.provider)) {
        this.successful.push(outcome.provider);
      }

      if (options.deduplicateResults) {
        appendUniqueSearchResults(this.results, outcome.results);
      } else {
        this.results.push(...outcome.results);
      }
    }
  }

  // Adds optional ID-enrichment results while keeping failures non-fatal and observable.
  // Добавляет результаты ID enrichment, оставляя ошибки нефатальными, но наблюдаемыми.
  appendIdEnrichment(outcomes: ProviderSearchCallOutcome[], skipped: number): void {
    this.observeEnrichment(outcomes, "id_enrichment", this.enrichment.id, skipped);

    for (const outcome of outcomes) {
      if (!outcome.failure) {
        appendUniqueSearchResults(this.results, outcome.results);
      }
    }
  }

  // Records optional poster-enrichment calls without promoting them to provider failures.
  // Учитывает optional poster enrichment без добавления его ошибок в provider failures.
  observePosterEnrichment(outcomes: ProviderDetailsCallOutcome[], skipped: number): void {
    this.observeEnrichment(outcomes, "poster_enrichment", this.enrichment.poster, skipped);
  }

  // Adds at most one aggregate warning per optional enrichment phase.
  // Добавляет не более одного агрегированного warning на каждую optional enrichment-фазу.
  appendEnrichmentWarnings(): void {
    appendEnrichmentWarning(this.warnings, ID_ENRICHMENT_WARNING, "ID", this.enrichment.id.failed);
    appendEnrichmentWarning(
      this.warnings,
      POSTER_ENRICHMENT_WARNING,
      "poster",
      this.enrichment.poster.failed,
    );
  }

  hasRetryableMandatoryFailure(): boolean {
    return this.retryableMandatoryFailures.size > 0;
  }

  getEnrichmentDebugMeta(): SearchEnrichmentDebugMeta {
    return structuredClone(this.enrichment);
  }

  private observeEnrichment(
    outcomes: EnrichmentOutcome[],
    phase: EnrichmentSearchPhase,
    counters: SearchEnrichmentCounters,
    skipped: number,
  ): void {
    counters.skipped += skipped;

    for (const outcome of outcomes) {
      counters.attempted += 1;
      this.timings.push(withPhase(outcome.timing, phase));

      if (outcome.failure) {
        counters.failed += 1;
      } else {
        counters.succeeded += 1;
      }
    }
  }

  private upsertFailure(failure: ProviderFailure, phase: MandatorySearchPhase): void {
    const phaseFailure: ProviderFailure = { ...failure, phase };
    const index = this.failed.findIndex((existing) => existing.provider === failure.provider);

    if (index === -1) {
      this.failed.push(phaseFailure);
    } else {
      this.failed[index] = phaseFailure;
    }
  }

  private removeFailure(provider: string): void {
    const index = this.failed.findIndex((failure) => failure.provider === provider);

    if (index !== -1) {
      this.failed.splice(index, 1);
    }
  }
}

function createCounters(): SearchEnrichmentCounters {
  return { attempted: 0, skipped: 0, succeeded: 0, failed: 0 };
}

function withPhase(timing: ProviderTimingMeta, phase: ProviderExecutionPhase): ProviderTimingMeta {
  return { ...timing, phase };
}

function appendEnrichmentWarning(
  warnings: EngineWarning[],
  code: string,
  label: string,
  failures: number,
): void {
  if (failures === 0) {
    return;
  }

  warnings.push({
    code,
    message: `Optional search ${label} enrichment failed for ${failures} provider ${failures === 1 ? "call" : "calls"}.`,
  });
}
