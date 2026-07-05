import type {
  MediaEngine,
  MediaProvider,
  StreamingProvider,
} from '@media-engine/core';

export interface MediaEngineEnv {
  TMDB_API_KEY?: string;
  TMDB_API_READ_ACCESS_TOKEN?: string;
  KODIK_TOKEN?: string;
}

// EN: Build providers from environment without requiring secrets for local boot.
// RU: Собираем провайдеры из env без обязательных секретов для локального запуска.
export async function createConfiguredProviders(
  env: MediaEngineEnv = process.env,
): Promise<MediaProvider[]> {
  const {
    cinemetaProvider,
    kinobdProvider,
    shikimoriProvider,
    tmdbProvider,
    wikidataProvider,
  } = await import('@media-engine/providers');
  const providers: MediaProvider[] = [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    wikidataProvider(),
  ];
  const tmdbApiKey = readOptionalEnv(
    env.TMDB_API_READ_ACCESS_TOKEN ?? env.TMDB_API_KEY,
  );

  if (tmdbApiKey !== undefined) {
    providers.push(tmdbProvider({ apiKey: tmdbApiKey }));
  }

  return providers;
}

// EN: Build streaming providers from environment without requiring them for local boot.
// RU: Собираем streaming-провайдеры из env без обязательности для локального запуска.
export async function createConfiguredStreamingProviders(
  env: MediaEngineEnv = process.env,
): Promise<StreamingProvider[]> {
  const { kodikProvider } = await import('@media-engine/providers');
  const providers: StreamingProvider[] = [];
  const kodikToken = readOptionalEnv(env.KODIK_TOKEN);

  if (kodikToken !== undefined) {
    providers.push(kodikProvider({ token: kodikToken }));
  }

  return providers;
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
  });
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
