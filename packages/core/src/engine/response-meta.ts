import type {
  EngineWarning,
  ProviderFailure,
  ProviderTimingMeta,
  ResponseMeta,
  SearchEnrichmentDebugMeta,
  SearchIdentitySnapshotDebugMeta,
} from "../response/index.js";

// Values used to build response metadata.
// Значения, используемые для создания метаданных ответа.
export interface ResponseMetaInput {
  requested: string[];
  successful: string[];
  failed: ProviderFailure[];
  warnings: EngineWarning[];
  cached: boolean;
  tookMs: number;
  debug: boolean;
  timings?: ProviderTimingMeta[];
  enrichment?: SearchEnrichmentDebugMeta;
  identitySnapshot?: SearchIdentitySnapshotDebugMeta;
}

// Creates public response metadata for engine calls.
// Создает публичные метаданные ответа для вызовов engine.
export function createResponseMeta(input: ResponseMetaInput): ResponseMeta {
  return {
    providers: {
      requested: input.requested,
      successful: input.successful,
      failed: input.failed,
    },
    cached: input.cached,
    tookMs: input.tookMs,
    warnings: input.warnings.length > 0 ? input.warnings : undefined,
    debug: input.debug
      ? {
          providers: [
            ...new Set([
              ...input.requested,
              ...(input.timings ?? []).map((timing) => timing.provider),
            ]),
          ],
          timings: input.timings ?? [],
          enrichment: input.enrichment,
          ...(input.identitySnapshot ? { identitySnapshot: input.identitySnapshot } : {}),
        }
      : undefined,
  };
}

// Returns elapsed milliseconds since a start timestamp.
// Возвращает количество миллисекунд, прошедших с начального timestamp.
export function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}
