import type {
  MediaEngine,
  MediaProvider,
  StreamingProvider,
  TorrentProvider,
} from '@media-engine/core';

export interface MediaEngineEnv {
  MEDIA_ENGINE_PROVIDER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_TORRENT_PROVIDERS?: string;
  MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS?: string;
  MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS?: string;
}

export const DEFAULT_MEDIA_ENGINE_PROVIDER_TIMEOUT_MS = 5_000;
export const DEFAULT_MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS = 10_000;
export const DEFAULT_MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS = 15_000;
export const DEFAULT_MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS = 15_000;
export const DEFAULT_MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS = 20_000;
export const DEFAULT_MEDIA_ENGINE_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_MEDIA_ENGINE_CACHE_STALE_TTL_MS = 30 * 60_000;
export const DEFAULT_MEDIA_ENGINE_CACHE_MAX_ENTRIES = 500;

const TORRENT_PROVIDER_NAMES = [
  'yts-torrent',
  'jacred-torrent',
  'bitsearch-torrent',
  'magnetz-torrent',
] as const;

export type ConfiguredTorrentProviderName =
  (typeof TORRENT_PROVIDER_NAMES)[number];

// EN: Build providers from environment without requiring secrets for local boot.
// RU: Собираем провайдеры из env без обязательных секретов для локального запуска.
export async function createConfiguredProviders(): Promise<MediaProvider[]> {
  const {
    cinemetaProvider,
    aniListProvider,
    kinobdProvider,
    shikimoriProvider,
    tvMazeProvider,
    wikidataProvider,
  } = await import('@media-engine/providers');
  const providers: MediaProvider[] = [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
    tvMazeProvider(),
    wikidataProvider(),
  ];
  return providers;
}

// EN: Build streaming providers from environment without requiring them for local boot.
// RU: Собираем streaming-провайдеры из env без обязательности для локального запуска.
export async function createConfiguredStreamingProviders(): Promise<
  StreamingProvider[]
> {
  const {
    aniLibertyStreamingProvider,
    ddbbStreamingProvider,
    flixHqStreamingProvider,
    kinobdStreamingProvider,
  } = await import('@media-engine/providers');
  return [
    kinobdStreamingProvider(),
    flixHqStreamingProvider(),
    ddbbStreamingProvider(),
    aniLibertyStreamingProvider(),
  ];
}

// EN: Build only the torrent providers explicitly enabled by environment.
// RU: Собираем только явно включенные через environment torrent-провайдеры.
export async function createConfiguredTorrentProviders(
  env: MediaEngineEnv = process.env,
): Promise<TorrentProvider[]> {
  const names = readTorrentProviderNames(env);

  if (names.length === 0) {
    return [];
  }

  const {
    bitsearchTorrentProvider,
    jacRedTorrentProvider,
    magnetzTorrentProvider,
    ytsTorrentProvider,
  } = await import('@media-engine/providers');
  const factories: Record<
    ConfiguredTorrentProviderName,
    () => TorrentProvider
  > = {
    'yts-torrent': ytsTorrentProvider,
    'jacred-torrent': jacRedTorrentProvider,
    'bitsearch-torrent': bitsearchTorrentProvider,
    'magnetz-torrent': magnetzTorrentProvider,
  };

  return names.map((name) => factories[name]());
}

// EN: Create the API-wide engine instance used by Nest dependency injection.
// RU: Создаем общий для API экземпляр движка, который использует Nest DI.
export async function createMediaEngine(
  env: MediaEngineEnv = process.env,
): Promise<MediaEngine> {
  const { MediaEngine, MemoryCache } = await import('@media-engine/core');
  const metadataTimeoutMs = readProviderTimeoutMs(env);
  const streamingTimeoutMs = readStreamingProviderTimeoutMs(env);
  const flixHqTimeoutMs = readFlixHqStreamingProviderTimeoutMs(env);
  const torrentTimeoutMs = readTorrentProviderTimeoutMs(env);
  const jacRedTorrentTimeoutMs = readJacRedTorrentProviderTimeoutMs(env);

  return new MediaEngine({
    providers: await createConfiguredProviders(),
    streamingProviders: await createConfiguredStreamingProviders(),
    torrentProviders: await createConfiguredTorrentProviders(env),
    cache: new MemoryCache({
      defaultTtlMs: DEFAULT_MEDIA_ENGINE_CACHE_TTL_MS,
      defaultStaleTtlMs: DEFAULT_MEDIA_ENGINE_CACHE_STALE_TTL_MS,
      maxEntries: DEFAULT_MEDIA_ENGINE_CACHE_MAX_ENTRIES,
    }),
    timeoutMs: Math.max(
      metadataTimeoutMs,
      streamingTimeoutMs,
      flixHqTimeoutMs,
      torrentTimeoutMs,
      jacRedTorrentTimeoutMs,
    ),
    providerTimeouts: {
      kinobd: metadataTimeoutMs,
      shikimori: metadataTimeoutMs,
      anilist: metadataTimeoutMs,
      tvmaze: metadataTimeoutMs,
      cinemeta: metadataTimeoutMs,
      wikidata: metadataTimeoutMs,
      'kinobd-streaming': streamingTimeoutMs,
      'flixhq-streaming': flixHqTimeoutMs,
      'ddbb-streaming': streamingTimeoutMs,
      'aniliberty-streaming': streamingTimeoutMs,
      'yts-torrent': torrentTimeoutMs,
      'jacred-torrent': jacRedTorrentTimeoutMs,
      'bitsearch-torrent': torrentTimeoutMs,
      'magnetz-torrent': torrentTimeoutMs,
    },
  });
}

export function readTorrentProviderNames(
  env: MediaEngineEnv = process.env,
): ConfiguredTorrentProviderName[] {
  const value = readOptionalEnv(env.MEDIA_ENGINE_TORRENT_PROVIDERS);

  if (value === undefined) {
    return [];
  }

  const names = value.split(',').map((name) => name.trim());

  if (names.some((name) => name.length === 0)) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_PROVIDERS must be a comma-separated list without empty names.',
    );
  }

  const unknown = names.filter(
    (name) =>
      !TORRENT_PROVIDER_NAMES.includes(name as ConfiguredTorrentProviderName),
  );

  if (unknown.length > 0) {
    throw new Error(
      `MEDIA_ENGINE_TORRENT_PROVIDERS contains unsupported providers: ${[
        ...new Set(unknown),
      ].join(', ')}.`,
    );
  }

  if (new Set(names).size !== names.length) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_PROVIDERS must not contain duplicate names.',
    );
  }

  return names as ConfiguredTorrentProviderName[];
}

export function readTorrentProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS',
  );
}

export function readJacRedTorrentProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS',
  );
}

// FlixHQ performs title lookup, episode resolution, and bounded player validation.
// FlixHQ выполняет поиск, резолв эпизода и ограниченную проверку плееров.
export function readFlixHqStreamingProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_FLIXHQ_STREAMING_PROVIDER_TIMEOUT_MS',
  );
}

// Streaming lookup covers bounded KinoBD, DDBB, and AniLiberty network work.
// Streaming lookup ограничивает сетевую работу KinoBD, DDBB и AniLiberty.
export function readStreamingProviderTimeoutMs(
  env: MediaEngineEnv = process.env,
): number {
  return readPositiveIntegerEnv(
    env.MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS,
    DEFAULT_MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS,
    'MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS',
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
