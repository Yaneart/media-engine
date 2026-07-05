import type {
  ExternalIds,
  MediaAvailability,
  MediaType,
  ProviderContext,
  StreamEpisodeAvailability,
  StreamEpisodeRef,
  StreamOption,
  StreamingProvider,
  StreamingProviderCapabilities,
  TranslationInfo,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const DEFAULT_PROVIDER_NAME = "kodik";
const DEFAULT_BASE_URL = "https://kodikapi.com";
const DEFAULT_LIMIT = 20;
const DEFAULT_TYPE_FILTERS: Record<MediaType, string[]> = {
  movie: ["foreign-movie", "russian-movie", "soviet-cartoon", "cartoon", "anime"],
  series: ["foreign-serial", "russian-serial", "cartoon-serial", "documentary-serial"],
  anime: ["anime", "anime-serial"],
};

// Options used to create a Kodik streaming provider.
// Опции для создания Kodik streaming-провайдера.
export interface KodikProviderOptions {
  token: string;
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  limit?: number;
  typeFilters?: Partial<Record<MediaType, string[]>>;
}

// Creates a Kodik streaming provider through the official token-based API surface.
// Создает Kodik streaming-провайдер через официальный token-based API surface.
export function kodikProvider(options: KodikProviderOptions): StreamingProvider {
  const token = normalizeRequiredString(options.token, "Kodik token is required.");
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const typeFilters = mergeTypeFilters(options.typeFilters);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("Kodik provider limit must be a positive integer.");
  }

  return {
    name,
    version: options.version,
    kind: "streaming",
    capabilities: createCapabilities(typeFilters),
    async getAvailability(query, context) {
      return getKodikAvailability({
        providerName: name,
        token,
        baseUrl,
        fetch: options.fetch,
        limit,
        typeFilters,
        query,
        context,
      });
    },
  };
}

// Internal input for one availability request.
// Внутренний input для одного availability-запроса.
interface KodikAvailabilityInput {
  providerName: string;
  token: string;
  baseUrl: string;
  fetch?: ProviderFetch;
  limit: number;
  typeFilters: Record<MediaType, string[]>;
  query: MediaAvailability["query"];
  context: ProviderContext;
}

// Minimal Kodik search response fields consumed by this provider.
// Минимальные поля Kodik search response, которые использует provider.
interface KodikSearchResponse {
  results?: KodikSearchItem[];
}

// Minimal Kodik media item shape used for player option normalization.
// Минимальная форма Kodik media item для нормализации player-вариантов.
interface KodikSearchItem {
  id?: string | number;
  type?: string;
  title?: string;
  title_orig?: string;
  other_title?: string;
  year?: number | string;
  link?: string;
  quality?: string;
  translation?: KodikTranslation;
  kinopoisk_id?: string | number;
  imdb_id?: string;
  shikimori_id?: string | number;
  seasons?: Record<string, KodikSeason>;
  episodes?: Record<string, KodikEpisodeValue>;
}

// Minimal Kodik translation shape.
// Минимальная форма Kodik translation.
interface KodikTranslation {
  id?: string | number;
  title?: string;
  type?: string;
}

// Minimal Kodik season shape with episode links.
// Минимальная форма Kodik season с episode links.
interface KodikSeason {
  episodes?: Record<string, KodikEpisodeValue>;
}

// Kodik episode values can be a direct URL or an object with a link.
// Значение Kodik episode может быть URL или объектом с link.
type KodikEpisodeValue =
  | string
  | {
      link?: string;
      title?: string;
    };

// Builds safe capabilities from configured type filters.
// Собирает безопасные capabilities из настроенных type filters.
function createCapabilities(
  typeFilters: Record<MediaType, string[]>,
): StreamingProviderCapabilities {
  return {
    mediaTypes: (Object.keys(typeFilters) as MediaType[]).filter(
      (type) => typeFilters[type].length > 0,
    ),
    lookup: {
      byTitle: true,
      byExternalIds: ["imdb", "kinopoisk", "shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  };
}

// Resolves Kodik availability for a single normalized stream query.
// Получает Kodik availability для одного нормализованного stream query.
async function getKodikAvailability(
  input: KodikAvailabilityInput,
): Promise<MediaAvailability | null> {
  if (input.query.providers && !input.query.providers.includes(input.providerName)) {
    return null;
  }

  const typeFilters = input.typeFilters[input.query.type];

  if (typeFilters.length === 0) {
    return null;
  }

  const url = createSearchUrl(input);
  const response = await fetchJson<KodikSearchResponse>({
    provider: input.providerName,
    url,
    context: input.context,
    fetch: input.fetch,
  });
  const items = response.results ?? [];
  const matchingItems = items.filter((item) => matchesQuery(input.query, item));
  const episodes = matchingItems.flatMap((item) =>
    createEpisodeAvailability(input.providerName, item, input.query),
  );
  const episodeOptions = episodes.flatMap((episode) => episode.options);
  const topLevelOptions = matchingItems.flatMap((item) =>
    createTopLevelOptions(input.providerName, item, input.query),
  );
  const options = uniqueBy([...topLevelOptions, ...episodeOptions], (option) => option.id);

  return {
    query: input.query,
    item: createAvailabilityItem(input.query, matchingItems[0]),
    episodes: episodes.length > 0 ? episodes : undefined,
    options,
    sourceProviders:
      matchingItems.length > 0
        ? [
            {
              provider: input.providerName,
              ids: collectIds(matchingItems[0]),
            },
          ]
        : [],
    checkedAt: new Date().toISOString(),
  };
}

// Creates the Kodik search API URL without exposing the token in public metadata.
// Создает Kodik search API URL без раскрытия token в публичных metadata.
function createSearchUrl(input: KodikAvailabilityInput): URL {
  const url = new URL("/search", `${input.baseUrl}/`);

  url.searchParams.set("token", input.token);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("with_material_data", "true");
  url.searchParams.set("types", input.typeFilters[input.query.type].join(","));

  if (input.query.title) {
    url.searchParams.set("title", input.query.title);
  }

  appendParam(url, "imdb_id", input.query.ids?.imdb);
  appendParam(url, "kinopoisk_id", input.query.ids?.kinopoisk);
  appendParam(url, "shikimori_id", input.query.ids?.shikimori);

  return url;
}

// Creates compact item metadata for the availability response.
// Создает компактные metadata item для availability response.
function createAvailabilityItem(
  query: MediaAvailability["query"],
  item: KodikSearchItem | undefined,
): MediaAvailability["item"] {
  return {
    type: query.type,
    title: item?.title ?? query.title,
    originalTitle: item?.title_orig,
    year: parseOptionalInteger(item?.year) ?? query.year,
    ids: collectIds(item) ?? query.ids,
  };
}

// Creates top-level options from direct Kodik item links.
// Создает top-level options из прямых Kodik item links.
function createTopLevelOptions(
  providerName: string,
  item: KodikSearchItem,
  query: MediaAvailability["query"],
): StreamOption[] {
  if (hasEpisodeQuery(query) || !item.link) {
    return [];
  }

  return [createOption(providerName, item, item.link)];
}

// Creates episode availability blocks from Kodik season or flat episode maps.
// Создает episode availability блоки из Kodik season или flat episode maps.
function createEpisodeAvailability(
  providerName: string,
  item: KodikSearchItem,
  query: MediaAvailability["query"],
): StreamEpisodeAvailability[] {
  const episodes = collectEpisodes(item);

  return episodes
    .filter((episode) => matchesEpisode(episode, query))
    .map((episode) => ({
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
      title: episode.title,
      options: [createOption(providerName, item, episode.link, episode)],
    }));
}

// Internal normalized Kodik episode.
// Внутренний нормализованный Kodik episode.
interface NormalizedKodikEpisode extends StreamEpisodeRef {
  title?: string;
  link: string;
}

// Collects season and flat episode maps into one normalized list.
// Собирает season и flat episode maps в один нормализованный список.
function collectEpisodes(item: KodikSearchItem): NormalizedKodikEpisode[] {
  const episodes: NormalizedKodikEpisode[] = [];

  for (const [seasonKey, season] of Object.entries(item.seasons ?? {})) {
    const seasonNumber = parseOptionalInteger(seasonKey);

    for (const [episodeKey, value] of Object.entries(season.episodes ?? {})) {
      const episodeNumber = parseOptionalInteger(episodeKey);
      const link = readEpisodeLink(value);

      if (episodeNumber !== undefined && link) {
        episodes.push({
          seasonNumber,
          episodeNumber,
          absoluteEpisodeNumber: seasonNumber === 1 ? episodeNumber : undefined,
          title: readEpisodeTitle(value),
          link,
        });
      }
    }
  }

  for (const [episodeKey, value] of Object.entries(item.episodes ?? {})) {
    const absoluteEpisodeNumber = parseOptionalInteger(episodeKey);
    const link = readEpisodeLink(value);

    if (absoluteEpisodeNumber !== undefined && link) {
      episodes.push({
        absoluteEpisodeNumber,
        title: readEpisodeTitle(value),
        link,
      });
    }
  }

  return uniqueBy(episodes, (episode) =>
    [
      episode.seasonNumber ?? "",
      episode.episodeNumber ?? "",
      episode.absoluteEpisodeNumber ?? "",
    ].join(":"),
  );
}

// Creates one normalized stream option from a Kodik link.
// Создает один нормализованный stream option из Kodik link.
function createOption(
  providerName: string,
  item: KodikSearchItem,
  link: string,
  episode?: StreamEpisodeRef,
): StreamOption {
  const translation = mapTranslation(item.translation);
  const qualityLabel = item.quality?.trim() || "auto";
  const episodeKey = episode
    ? [
        episode.seasonNumber ?? "s",
        episode.episodeNumber ?? "e",
        episode.absoluteEpisodeNumber ?? "a",
      ].join("-")
    : "main";

  return {
    id: `${providerName}:${item.id ?? normalizeOptionId(item.title ?? item.link ?? "item")}:${episodeKey}:${
      item.translation?.id ?? translation.title
    }`,
    provider: providerName,
    player: {
      kind: "embed",
      label: "Kodik",
      providerPlayerId: item.id === undefined ? undefined : String(item.id),
    },
    translation,
    quality: {
      label: qualityLabel,
      height: parseQualityHeight(qualityLabel),
    },
    episode,
    access: {
      url: normalizeKodikLink(link),
    },
    availability: "available",
    sourceUrl: item.link ? normalizeKodikLink(item.link) : undefined,
  };
}

// Checks whether a Kodik API item still matches the requested media identity.
// Проверяет, что Kodik API item все еще соответствует запрошенной media identity.
function matchesQuery(query: MediaAvailability["query"], item: KodikSearchItem): boolean {
  if (query.ids?.imdb && item.imdb_id && query.ids.imdb !== item.imdb_id) {
    return false;
  }

  if (
    query.ids?.kinopoisk &&
    item.kinopoisk_id &&
    query.ids.kinopoisk !== String(item.kinopoisk_id)
  ) {
    return false;
  }

  if (
    query.ids?.shikimori &&
    item.shikimori_id &&
    query.ids.shikimori !== String(item.shikimori_id)
  ) {
    return false;
  }

  if (
    query.year !== undefined &&
    item.year !== undefined &&
    query.year !== parseOptionalInteger(item.year)
  ) {
    return false;
  }

  return true;
}

// Checks whether an episode matches episode fields from query.
// Проверяет, совпадает ли episode с episode-полями query.
function matchesEpisode(episode: StreamEpisodeRef, query: MediaAvailability["query"]): boolean {
  if (!hasEpisodeQuery(query)) {
    return true;
  }

  return (
    matchesOptionalNumber(episode.seasonNumber, query.seasonNumber) &&
    matchesOptionalNumber(episode.episodeNumber, query.episodeNumber) &&
    matchesOptionalNumber(episode.absoluteEpisodeNumber, query.absoluteEpisodeNumber)
  );
}

// Maps Kodik translation labels into normalized translation metadata.
// Мапит Kodik translation labels в нормализованные translation metadata.
function mapTranslation(translation: KodikTranslation | undefined): TranslationInfo {
  const rawType = translation?.type?.trim().toLocaleLowerCase();

  return {
    id: translation?.id === undefined ? undefined : String(translation.id),
    title: translation?.title?.trim() || "Kodik",
    type:
      rawType === "subtitles"
        ? "subtitles"
        : rawType === "original"
          ? "original"
          : rawType === "voice"
            ? "voiceover"
            : "unknown",
    language: "ru",
  };
}

// Collects known external IDs from a Kodik item.
// Собирает известные external IDs из Kodik item.
function collectIds(item: KodikSearchItem | undefined): ExternalIds | undefined {
  if (!item) {
    return undefined;
  }

  const ids: ExternalIds = {};

  if (item.imdb_id) {
    ids.imdb = item.imdb_id;
  }

  if (item.kinopoisk_id !== undefined) {
    ids.kinopoisk = String(item.kinopoisk_id);
  }

  if (item.shikimori_id !== undefined) {
    ids.shikimori = String(item.shikimori_id);
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
}

// Reads an episode link from either string or object episode values.
// Читает episode link из string или object episode values.
function readEpisodeLink(value: KodikEpisodeValue): string | undefined {
  return typeof value === "string" ? value : value.link;
}

// Reads an episode title from object episode values.
// Читает episode title из object episode values.
function readEpisodeTitle(value: KodikEpisodeValue): string | undefined {
  return typeof value === "string" ? undefined : value.title;
}

// Normalizes Kodik protocol-relative links for browser clients.
// Нормализует Kodik protocol-relative links для browser clients.
function normalizeKodikLink(link: string): string {
  const trimmed = link.trim();

  return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
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

// Matches optional numeric fields strictly when query value exists.
// Строго сравнивает опциональные числовые поля, если query значение есть.
function matchesOptionalNumber(value: number | undefined, queryValue: number | undefined): boolean {
  return queryValue === undefined || value === queryValue;
}

// Appends a non-empty string query parameter.
// Добавляет непустой string query parameter.
function appendParam(url: URL, key: string, value: string | undefined): void {
  if (value) {
    url.searchParams.set(key, value);
  }
}

// Merges media type filters with defaults.
// Объединяет media type filters с defaults.
function mergeTypeFilters(
  overrides: Partial<Record<MediaType, string[]>> | undefined,
): Record<MediaType, string[]> {
  return {
    movie: overrides?.movie ?? DEFAULT_TYPE_FILTERS.movie,
    series: overrides?.series ?? DEFAULT_TYPE_FILTERS.series,
    anime: overrides?.anime ?? DEFAULT_TYPE_FILTERS.anime,
  };
}

// Validates and normalizes provider name.
// Проверяет и нормализует имя provider.
function normalizeProviderName(name: string): string {
  return normalizeRequiredString(name, "Kodik provider name is required.");
}

// Validates and normalizes required strings.
// Проверяет и нормализует обязательные строки.
function normalizeRequiredString(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError(message);
  }

  return normalized;
}

// Normalizes a base URL by trimming trailing slashes.
// Нормализует base URL, убирая trailing slashes.
function normalizeBaseUrl(value: string): string {
  return normalizeRequiredString(value, "Kodik baseUrl is required.").replace(/\/+$/, "");
}

// Parses optional integer-like values.
// Парсит опциональные integer-like значения.
function parseOptionalInteger(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  return Number.isInteger(parsed) ? parsed : undefined;
}

// Parses common quality labels like 720p or 1080p.
// Парсит распространенные quality labels вроде 720p или 1080p.
function parseQualityHeight(label: string): number | undefined {
  const match = /(\d{3,4})p?/i.exec(label);

  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

// Creates a compact fallback option id segment.
// Создает компактный fallback segment для option id.
function normalizeOptionId(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
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
