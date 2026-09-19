import type { CacheSetOptions } from "../cache/index.js";
import type { ExternalIds, MediaItem } from "../media/index.js";
import type { ExternalIdSource } from "../providers/index.js";
import type { SearchResponse } from "../search/index.js";
import type {
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
  StreamQuery,
  StreamSeasonAvailability,
  StreamingProvider,
  StreamingProviderSource,
} from "../streaming/index.js";
import { normalizeTitle, titleCandidates } from "../merge/title.js";
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

// Finds external IDs needed by configured streaming providers that cannot use the current query.
// Находит внешние ID для streaming-провайдеров, которые не умеют использовать текущий запрос.
export function getMissingStreamingIdentitySources(
  providers: StreamingProvider[],
  query: StreamQuery,
): ExternalIdSource[] {
  const missing = new Set<ExternalIdSource>();

  for (const provider of providers) {
    if (query.providers && !query.providers.includes(provider.name)) continue;
    if (!provider.capabilities.mediaTypes.includes(query.type)) continue;
    if (hasEpisodeQuery(query) && !provider.capabilities.lookup.byEpisode) continue;
    if (query.title && provider.capabilities.lookup.byTitle) continue;
    if (hasSupportedExternalId(query.ids, provider.capabilities.lookup.byExternalIds)) continue;

    for (const source of provider.capabilities.lookup.byExternalIds) {
      if (!query.ids?.[source]) missing.add(source);
    }
  }

  return [...missing];
}

// Adds only unambiguous IDs from metadata search candidates confirmed as the same media identity.
// Добавляет только однозначные ID из metadata-кандидатов с подтвержденной идентичностью.
export function enrichStreamQueryIdentity(
  query: StreamQuery,
  response: SearchResponse,
  requestedSources: readonly ExternalIdSource[],
): StreamQuery {
  if (
    requestedSources.length === 0 ||
    response.meta.warnings?.some((warning) => warning.code === "EXTERNAL_ID_CONFLICT")
  ) {
    return query;
  }

  const candidates = response.results
    .map((result) => result.item)
    .filter((item) => matchesStreamIdentity(query, item));
  const ids: ExternalIds = { ...query.ids };
  let enriched = false;

  for (const source of requestedSources) {
    if (ids[source]) continue;
    const values = new Set(
      candidates
        .map((candidate) => candidate.ids?.[source])
        .filter((value): value is string => Boolean(value)),
    );

    if (values.size === 1) {
      ids[source] = [...values][0];
      enriched = true;
    }
  }

  return enriched ? { ...query, ids } : query;
}

// Merges availability results without hiding provider attribution.
// Объединяет availability-результаты, не скрывая атрибуцию провайдеров.
export function mergeAvailabilityResults(
  query: StreamQuery,
  results: MediaAvailability[],
): MediaAvailability {
  const episodes = mergeEpisodeAvailability(results);
  const seasons = createSeasonAvailability(episodes);

  return {
    query,
    item: results.find((result) => result.item)?.item,
    ...(seasons ? { seasons } : {}),
    episodes,
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

// Groups a normalized flat episode catalog into selectable seasons.
// Группирует нормализованный плоский каталог эпизодов в выбираемые сезоны.
function createSeasonAvailability(
  episodes: StreamEpisodeAvailability[] | undefined,
): StreamSeasonAvailability[] | undefined {
  const seasons = new Map<number, StreamEpisodeAvailability[]>();

  for (const episode of episodes ?? []) {
    if (episode.seasonNumber === undefined) continue;
    const entries = seasons.get(episode.seasonNumber) ?? [];
    entries.push(episode);
    seasons.set(episode.seasonNumber, entries);
  }

  return seasons.size
    ? [...seasons.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seasonNumber, seasonEpisodes]) => ({
          seasonNumber,
          episodes: seasonEpisodes.sort(
            (left, right) =>
              (left.episodeNumber ?? Number.MAX_SAFE_INTEGER) -
              (right.episodeNumber ?? Number.MAX_SAFE_INTEGER),
          ),
          episodesCount: seasonEpisodes.length,
        }))
    : undefined;
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

// Detects player options kept after validation could not reach a reliable conclusion.
// Находит player options, сохраненные после неопределенного результата validation.
export function hasUnknownStreamValidation(availability: MediaAvailability): boolean {
  return [
    ...availability.options,
    ...(availability.episodes?.flatMap((episode) => episode.options) ?? []),
  ].some((option) => option.availability === "unknown");
}

// Merges episode-level availability blocks by episode identity.
// Объединяет episode-level availability блоки по идентичности эпизода.
function mergeEpisodeAvailability(
  results: MediaAvailability[],
): StreamEpisodeAvailability[] | undefined {
  const episodesByKey = new Map<string, StreamEpisodeAvailability>();

  for (const episode of results.flatMap((result) => [
    ...(result.episodes ?? []),
    ...(result.seasons?.flatMap((season) => season.episodes) ?? []),
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

function matchesStreamIdentity(query: StreamQuery, item: MediaItem): boolean {
  if (item.type !== query.type || hasExternalIdConflict(query.ids, item.ids)) return false;
  if (hasSharedExternalId(query.ids, item.ids)) return true;
  if (!query.title || query.year === undefined || item.year !== query.year) return false;

  const title = normalizeTitle(query.title);
  return (
    Boolean(title) && titleCandidates(item).some((candidate) => normalizeTitle(candidate) === title)
  );
}

function hasSharedExternalId(left: ExternalIds | undefined, right: ExternalIds | undefined) {
  if (!left || !right) return false;
  return Object.keys(left).some((key) => {
    const source = key as keyof ExternalIds;
    return Boolean(left[source] && left[source] === right[source]);
  });
}

function hasExternalIdConflict(left: ExternalIds | undefined, right: ExternalIds | undefined) {
  if (!left || !right) return false;
  return Object.keys(left).some((key) => {
    const source = key as keyof ExternalIds;
    return Boolean(left[source] && right[source] && left[source] !== right[source]);
  });
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
