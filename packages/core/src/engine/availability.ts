import type { CacheSetOptions } from "../cache/index.js";
import type { ExternalIds } from "../media/index.js";
import type {
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
  StreamQuery,
  StreamingProvider,
  StreamingProviderSource,
} from "../streaming/index.js";
import { sortObject } from "./query.js";

const EXPIRING_AVAILABILITY_CACHE_SAFETY_MS = 1_000;

// Selects streaming providers that can answer the normalized stream query.
// Выбирает streaming-провайдеры, которые могут ответить на нормализованный stream query.
export function selectStreamingProviders(
  providers: StreamingProvider[],
  query: StreamQuery,
): StreamingProvider[] {
  return providers.filter((provider) => {
    if (query.providers && !query.providers.includes(provider.name)) {
      return false;
    }

    if (!provider.capabilities.mediaTypes.includes(query.type)) {
      return false;
    }

    if (hasEpisodeQuery(query) && !provider.capabilities.lookup.byEpisode) {
      return false;
    }

    return (
      Boolean(query.title && provider.capabilities.lookup.byTitle) ||
      hasSupportedExternalId(query.ids, provider.capabilities.lookup.byExternalIds)
    );
  });
}

// Merges availability results without hiding provider attribution.
// Объединяет availability-результаты, не скрывая атрибуцию провайдеров.
export function mergeAvailabilityResults(
  query: StreamQuery,
  results: MediaAvailability[],
): MediaAvailability {
  return {
    query,
    item: results.find((result) => result.item)?.item,
    episodes: mergeEpisodeAvailability(results),
    options: uniqueBy(
      results.flatMap((result) => result.options),
      (option) => `${option.provider}:${option.id}`,
    ),
    sourceProviders: uniqueBy(
      results.flatMap((result) => result.sourceProviders),
      (source) => createStreamingSourceKey(source),
    ),
    checkedAt: new Date().toISOString(),
  };
}

// Keeps cached direct links from outliving the earliest advertised expiration.
// Не позволяет кешированным прямым ссылкам пережить ближайший заявленный срок действия.
export function createAvailabilityCacheOptions(
  availability: MediaAvailability,
): CacheSetOptions | undefined {
  const expiresAtValues = [
    ...availability.options,
    ...(availability.episodes?.flatMap((episode) => episode.options) ?? []),
  ]
    .map((option) => option.expiresAt)
    .filter((value): value is string => value !== undefined)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  if (expiresAtValues.length === 0) {
    return { staleTtlMs: 0 };
  }

  const earliestExpiration = Math.min(...expiresAtValues);

  return {
    ttlMs: Math.max(0, earliestExpiration - Date.now() - EXPIRING_AVAILABILITY_CACHE_SAFETY_MS),
    staleTtlMs: 0,
  };
}

// Merges episode-level availability blocks by episode identity.
// Объединяет episode-level availability блоки по идентичности эпизода.
function mergeEpisodeAvailability(
  results: MediaAvailability[],
): StreamEpisodeAvailability[] | undefined {
  const episodesByKey = new Map<string, StreamEpisodeAvailability>();

  for (const episode of results.flatMap((result) => [
    ...(result.episodes ?? []),
    ...createEpisodeAvailabilityFromOptions(result.options),
  ])) {
    const key = createEpisodeKey(episode);
    const existing = episodesByKey.get(key);

    if (!existing) {
      episodesByKey.set(key, {
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
        title: episode.title,
        options: uniqueBy(episode.options, (option) => `${option.provider}:${option.id}`),
      });
      continue;
    }

    existing.options = uniqueBy(
      [...existing.options, ...episode.options],
      (option) => `${option.provider}:${option.id}`,
    );
    existing.title ??= episode.title;
  }

  return episodesByKey.size > 0 ? [...episodesByKey.values()] : undefined;
}

// Creates episode blocks from top-level options that carry episode identity.
// Создает episode blocks из top-level options, которые содержат идентичность эпизода.
function createEpisodeAvailabilityFromOptions(
  options: StreamOption[],
): StreamEpisodeAvailability[] {
  return options
    .filter((option) => option.episode)
    .map((option) => ({
      seasonNumber: option.episode?.seasonNumber,
      episodeNumber: option.episode?.episodeNumber,
      absoluteEpisodeNumber: option.episode?.absoluteEpisodeNumber,
      options: [option],
    }));
}

// Checks whether query ids overlap provider-supported external ID sources.
// Проверяет, пересекаются ли query ids с поддерживаемыми провайдером источниками ID.
function hasSupportedExternalId(
  ids: ExternalIds | undefined,
  supportedSources: readonly string[],
): boolean {
  return Boolean(
    ids && supportedSources.some((source) => Boolean(ids[source as keyof ExternalIds])),
  );
}

// Checks whether query targets a concrete episode.
// Проверяет, нацелен ли query на конкретный эпизод.
function hasEpisodeQuery(query: StreamQuery): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}

// Creates a stable identity for an episode availability block.
// Создает стабильную идентичность для блока доступности эпизода.
function createEpisodeKey(episode: StreamEpisodeAvailability): string {
  return [
    episode.seasonNumber ?? "",
    episode.episodeNumber ?? "",
    episode.absoluteEpisodeNumber ?? "",
  ].join(":");
}

// Creates a stable identity for provider source attribution.
// Создает стабильную идентичность для атрибуции источника провайдера.
function createStreamingSourceKey(source: StreamingProviderSource): string {
  return `${source.provider}:${source.url ?? ""}:${JSON.stringify(sortObject(source.ids ?? {}))}`;
}

// Keeps the first value for each derived key.
// Оставляет первое значение для каждого вычисленного ключа.
function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const value of values) {
    const key = getKey(value);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(value);
    }
  }

  return unique;
}
