import type { MediaEngine, MediaProvider } from '@media-engine/core';

export interface MediaEngineEnv {
  TMDB_API_KEY?: string;
  TMDB_API_READ_ACCESS_TOKEN?: string;
}

// EN: Build providers from environment without requiring secrets for local boot.
// RU: Собираем провайдеры из env без обязательных секретов для локального запуска.
export async function createConfiguredProviders(
  env: MediaEngineEnv = process.env,
): Promise<MediaProvider[]> {
  const { shikimoriProvider, tmdbProvider } =
    await import('@media-engine/providers');
  const providers: MediaProvider[] = [shikimoriProvider()];
  const tmdbApiKey = readOptionalEnv(
    env.TMDB_API_READ_ACCESS_TOKEN ?? env.TMDB_API_KEY,
  );

  if (tmdbApiKey !== undefined) {
    providers.push(tmdbProvider({ apiKey: tmdbApiKey }));
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
  });
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
