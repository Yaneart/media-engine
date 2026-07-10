import type {
  MediaEngine,
  MediaProvider,
  StreamingProvider,
} from '@media-engine/core';

export interface MediaEngineEnv {
  MEDIA_ENGINE_PROVIDER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS?: string;
}

export const DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS = 5_000;
export const DEFAULT_MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS = 2_500;

// EN: Build providers from environment without requiring secrets for local boot.
// RU: Собираем провайдеры из env без обязательных секретов для локального запуска.
export async function createConfiguredProviders(
  env: MediaEngineEnv = process.env,
): Promise<MediaProvider[]> {
  const {
    cinemetaProvider,
    kinobdProvider,
    shikimoriProvider,
    wikidataProvider,
  } = await import('@media-engine/providers');
  const providers: MediaProvider[] = [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    wikidataProvider(),
  ];
  return providers;
}

// EN: Build streaming providers from environment without requiring them for local boot.
// RU: Собираем streaming-провайдеры из env без обязательности для локального запуска.
export async function createConfiguredStreamingProviders(
  env: MediaEngineEnv = process.env,
): Promise<StreamingProvider[]> {
  const { kinobdStreamingProvider } = await import('@media-engine/providers');
  return [kinobdStreamingProvider()];
}

// EN: Create the API-wide engine instance used by Nest dependency injection.
// RU: Создаем общий для API экземпляр движка, который использует Nest DI.
export async function createMediaEngine(
  env: MediaEngineEnv = process.env,
): Promise<MediaEngine> {
  const { MediaEngine } = await import('@media-engine/core');

  return new MediaEngine({
    providers: await createConfiguredProviders(env),
    streamingProviders: await createConfiguredStreamingProviders(env),
    timeoutMs: readProviderTimeoutMs(env),
    providerTimeouts: {
      cinemeta: readEnrichmentProviderTimeoutMs(env),
      wikidata: readEnrichmentProviderTimeoutMs(env),
    },
  });
}

export function readEnrichmentProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS',
  );
}

export function readProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_PROVIDER_TIMEOUT_MS',
  );
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function readPositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const normalizedValue = readOptionalEnv(value);

  if (normalizedValue === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
}
