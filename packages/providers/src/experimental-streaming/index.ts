import type {
  ExternalIdSource,
  ExternalIds,
  MediaAvailability,
  MediaType,
  ProviderContext,
  StreamEpisodeAvailability,
  StreamEpisodeRef,
  StreamOption,
  StreamingProvider,
  StreamingProviderCapabilities,
} from "@media-engine/core";

const DEFAULT_PROVIDER_NAME = "experimental-streaming";
const EXTERNAL_ID_SOURCES: ExternalIdSource[] = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
];

// Options used to create a local experimental streaming provider.
// Опции для создания локального экспериментального streaming-провайдера.
export interface ExperimentalStreamingProviderOptions {
  name?: string;
  version?: string;
  entries: ExperimentalStreamingEntry[];
}

// One configured media item with allowed player options.
// Один настроенный медиа-объект с разрешенными player-вариантами.
export interface ExperimentalStreamingEntry {
  type: MediaType;
  title?: string;
  originalTitle?: string;
  year?: number;
  ids?: ExternalIds;
  sourceUrl?: string;
  options?: ExperimentalStreamOptionInput[];
  episodes?: ExperimentalStreamingEpisode[];
}

// One configured episode with its selectable player options.
// Один настроенный эпизод с выбираемыми player-вариантами.
export interface ExperimentalStreamingEpisode extends StreamEpisodeRef {
  title?: string;
  options: ExperimentalStreamOptionInput[];
}

// Stream option input where provider name is filled by the factory.
// Входной stream-вариант, где имя провайдера заполняет factory.
export type ExperimentalStreamOptionInput = Omit<StreamOption, "provider"> & {
  provider?: string;
};

// Creates a configured streaming provider for architecture validation.
// Создает настроенный streaming-провайдер для проверки архитектуры.
export function experimentalStreamingProvider(
  options: ExperimentalStreamingProviderOptions,
): StreamingProvider {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);
  const entries = options.entries.map(normalizeEntry);
  const capabilities = createCapabilities(entries);

  return {
    name,
    version: options.version,
    kind: "streaming",
    capabilities,
    async getAvailability(query, context) {
      return getExperimentalAvailability(name, entries, query, context);
    },
  };
}

// Normalized entry stored inside the provider.
// Нормализованная запись, которая хранится внутри провайдера.
interface NormalizedStreamingEntry extends ExperimentalStreamingEntry {
  titleKey?: string;
}

// Validates and normalizes provider name.
// Проверяет и нормализует имя провайдера.
function normalizeProviderName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new TypeError("Experimental streaming provider name is required.");
  }

  return normalized;
}

// Adds lookup helpers without changing the public entry shape.
// Добавляет lookup helpers без изменения публичной формы записи.
function normalizeEntry(entry: ExperimentalStreamingEntry): NormalizedStreamingEntry {
  return {
    ...entry,
    titleKey: entry.title ? normalizeTitle(entry.title) : undefined,
  };
}

// Builds safe capabilities from configured entries.
// Собирает безопасные capabilities из настроенных записей.
function createCapabilities(entries: NormalizedStreamingEntry[]): StreamingProviderCapabilities {
  return {
    mediaTypes: unique(entries.map((entry) => entry.type)),
    lookup: {
      byTitle: entries.some((entry) => Boolean(entry.title)),
      byExternalIds: collectExternalIdSources(entries),
      byEpisode: entries.some(
        (entry) =>
          Boolean(entry.episodes?.length) ||
          Boolean(entry.options?.some((option) => hasEpisodeRef(option.episode))),
      ),
    },
    features: ["embed", "external", "translations", "subtitles", "qualities", "episode_mapping"],
  };
}

// Resolves availability for a single stream query.
// Получает доступность для одного stream-запроса.
async function getExperimentalAvailability(
  providerName: string,
  entries: NormalizedStreamingEntry[],
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | null> {
  if (query.providers && !query.providers.includes(providerName)) {
    return null;
  }

  const entry = entries.find((candidate) => matchesEntry(candidate, query));

  if (!entry) {
    return null;
  }

  if (context.signal?.aborted) {
    throw context.signal.reason;
  }

  const episodes = filterEpisodes(providerName, entry, query);
  const topLevelOptions = filterTopLevelOptions(providerName, entry, query);
  const episodeOptions = episodes.flatMap((episode) => episode.options);
  const options = [...topLevelOptions, ...episodeOptions];

  return {
    query,
    item: {
      type: entry.type,
      title: entry.title,
      originalTitle: entry.originalTitle,
      year: entry.year,
      ids: entry.ids,
    },
    episodes: episodes.length > 0 ? episodes : undefined,
    options,
    sourceProviders: [
      {
        provider: providerName,
        ids: entry.ids,
        url: entry.sourceUrl,
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

// Checks whether a configured entry can answer the query.
// Проверяет, может ли настроенная запись ответить на запрос.
function matchesEntry(entry: NormalizedStreamingEntry, query: MediaAvailability["query"]): boolean {
  if (entry.type !== query.type) {
    return false;
  }

  if (matchesAnyExternalId(entry.ids, query.ids)) {
    return true;
  }

  if (!entry.titleKey || !query.title) {
    return false;
  }

  return entry.titleKey === normalizeTitle(query.title) && matchesYear(entry.year, query.year);
}

// Filters episode blocks for an episode-aware query.
// Фильтрует блоки эпизодов для episode-aware запроса.
function filterEpisodes(
  providerName: string,
  entry: ExperimentalStreamingEntry,
  query: MediaAvailability["query"],
): StreamEpisodeAvailability[] {
  return (entry.episodes ?? [])
    .filter((episode) => matchesEpisode(episode, query))
    .map((episode) => ({
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
      title: episode.title,
      options: episode.options.map((option) => normalizeOption(providerName, option, episode)),
    }));
}

// Filters top-level options and keeps only requested episode options when needed.
// Фильтрует верхнеуровневые варианты и оставляет варианты нужного эпизода при запросе.
function filterTopLevelOptions(
  providerName: string,
  entry: ExperimentalStreamingEntry,
  query: MediaAvailability["query"],
): StreamOption[] {
  return (entry.options ?? [])
    .filter((option) => matchesEpisode(option.episode, query))
    .map((option) => normalizeOption(providerName, option, option.episode));
}

// Fills provider and episode fields on a stream option.
// Заполняет provider и episode поля в stream-варианте.
function normalizeOption(
  providerName: string,
  option: ExperimentalStreamOptionInput,
  episode: StreamEpisodeRef | undefined,
): StreamOption {
  return {
    ...option,
    provider: option.provider ?? providerName,
    episode: option.episode ?? episode,
  };
}

// Checks exact external ID overlap between entry and query.
// Проверяет точное пересечение внешних ID между записью и запросом.
function matchesAnyExternalId(
  entryIds: ExternalIds | undefined,
  queryIds: ExternalIds | undefined,
): boolean {
  if (!entryIds || !queryIds) {
    return false;
  }

  return EXTERNAL_ID_SOURCES.some(
    (source) => entryIds[source] !== undefined && entryIds[source] === queryIds[source],
  );
}

// Checks whether years are compatible when both sides provide them.
// Проверяет совместимость годов, если обе стороны их передали.
function matchesYear(entryYear: number | undefined, queryYear: number | undefined): boolean {
  return entryYear === undefined || queryYear === undefined || entryYear === queryYear;
}

// Checks whether an episode reference matches the episode fields from query.
// Проверяет, совпадает ли ссылка на эпизод с episode-полями запроса.
function matchesEpisode(
  episode: StreamEpisodeRef | undefined,
  query: MediaAvailability["query"],
): boolean {
  if (!hasEpisodeQuery(query)) {
    return true;
  }

  if (!episode) {
    return false;
  }

  return (
    matchesOptionalNumber(episode.seasonNumber, query.seasonNumber) &&
    matchesOptionalNumber(episode.episodeNumber, query.episodeNumber) &&
    matchesOptionalNumber(episode.absoluteEpisodeNumber, query.absoluteEpisodeNumber)
  );
}

// Checks whether query contains episode targeting fields.
// Проверяет, содержит ли query поля выбора эпизода.
function hasEpisodeQuery(query: MediaAvailability["query"]): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}

// Checks whether an option or configured episode has any episode reference.
// Проверяет, есть ли у варианта или настроенного эпизода ссылка на эпизод.
function hasEpisodeRef(episode: StreamEpisodeRef | undefined): boolean {
  return (
    episode?.seasonNumber !== undefined ||
    episode?.episodeNumber !== undefined ||
    episode?.absoluteEpisodeNumber !== undefined
  );
}

// Matches optional numeric fields strictly when query value exists.
// Строго сравнивает опциональные числовые поля, если query значение есть.
function matchesOptionalNumber(value: number | undefined, queryValue: number | undefined): boolean {
  return queryValue === undefined || value === queryValue;
}

// Collects external ID sources present in configured entries.
// Собирает источники внешних ID из настроенных записей.
function collectExternalIdSources(entries: NormalizedStreamingEntry[]): ExternalIdSource[] {
  return EXTERNAL_ID_SOURCES.filter((source) =>
    entries.some((entry) => entry.ids?.[source] !== undefined),
  );
}

// Normalizes titles for exact configured-title lookup.
// Нормализует названия для точного поиска по настроенному title.
function normalizeTitle(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

// Keeps array values unique while preserving order.
// Оставляет уникальные значения массива с сохранением порядка.
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
