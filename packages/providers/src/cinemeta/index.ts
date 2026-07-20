import type {
  ExternalIds,
  Image,
  MediaDetails,
  MediaItem,
  MediaStatus,
  MovieDetails,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
  SeriesDetails,
} from "@media-engine/core";
import { ProviderError, type MediaProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  fetchJson,
  getProviderHttpStatus,
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import { createProviderImage, mapGenreNames } from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";

const PROVIDER_NAME = "cinemeta";
const DEFAULT_BASE_URL = "https://v3-cinemeta.strem.io";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_ENRICH_SEARCH_LIMIT = 5;
const DEFAULT_IMAGE_LIMIT = 10;
const DEFAULT_PERSON_LIMIT = 30;

// Options used to create a Cinemeta metadata provider.
// Опции для создания metadata-провайдера Cinemeta.
export interface CinemetaProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
  enrichSearchLimit?: number;
  imageLimit?: number;
  personLimit?: number;
}

// Creates a no-token movie and series provider backed by the public Cinemeta addon API.
// Создает no-token provider фильмов и сериалов на публичном Cinemeta addon API.
export function cinemetaProvider(options: CinemetaProviderOptions = {}): MediaProvider {
  const config = createCinemetaConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["movie", "series"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
      features: ["posters", "backdrops", "ratings", "genres", "persons"],
    },
    async search(query, context) {
      return searchCinemeta(config, query, context);
    },
    async getDetails(query, context) {
      return getCinemetaDetails(config, query, context);
    },
  };
}

// Internal normalized Cinemeta configuration.
// Внутренняя нормализованная конфигурация Cinemeta.
interface CinemetaConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
  enrichSearchLimit: number;
  imageLimit: number;
  personLimit: number;
}

interface CinemetaCatalogResponse {
  metas?: CinemetaMetaSummary[];
}

interface CinemetaMetaResponse {
  meta?: CinemetaMetaDetails;
}

interface CinemetaMetaSummary {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  poster?: string;
  background?: string;
  releaseInfo?: string;
  description?: string;
  imdbRating?: string;
  moviedb_id?: number;
  genres?: string[];
  genre?: string[];
}

interface CinemetaMetaDetails extends CinemetaMetaSummary {
  runtime?: string;
  released?: string;
  country?: string;
  director?: string[];
  writer?: string[];
  cast?: string[];
  status?: string;
  videos?: CinemetaVideo[];
}

interface CinemetaVideo {
  season?: number;
  number?: number;
  episode?: number;
}

// Builds provider config from public options.
// Собирает конфигурацию provider из публичных options.
function createCinemetaConfig(options: CinemetaProviderOptions): CinemetaConfig {
  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "Cinemeta searchLimit",
      1,
      100,
    ),
    enrichSearchLimit: resolveBoundedIntegerOption(
      options.enrichSearchLimit,
      DEFAULT_ENRICH_SEARCH_LIMIT,
      "Cinemeta enrichSearchLimit",
      0,
      100,
    ),
    imageLimit: resolveBoundedIntegerOption(
      options.imageLimit,
      DEFAULT_IMAGE_LIMIT,
      "Cinemeta imageLimit",
      0,
      100,
    ),
    personLimit: resolveBoundedIntegerOption(
      options.personLimit,
      DEFAULT_PERSON_LIMIT,
      "Cinemeta personLimit",
      0,
      100,
    ),
  };
}

// Searches Cinemeta catalog by title or IMDb ID.
// Ищет в Cinemeta catalog по названию или IMDb ID.
async function searchCinemeta(
  config: CinemetaConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type === "anime") {
    return [];
  }

  if (query.ids?.imdb) {
    const details = await getDetailsByImdbId(config, query.ids.imdb, query.type, context);
    return details ? [detailsToSearchResult(details, context.debug)] : [];
  }

  if (!query.title?.trim()) {
    return [];
  }

  const types = query.type ? [query.type] : (["movie", "series"] as const);
  const results = await Promise.all(
    types.map(async (type) => searchCatalogType(config, type, query, context)),
  );

  return results.flat().sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0));
}

// Loads Cinemeta details by IMDb ID.
// Загружает Cinemeta details по IMDb ID.
async function getCinemetaDetails(
  config: CinemetaConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (!query.ids?.imdb) {
    return null;
  }

  const details = await getDetailsByImdbId(config, query.ids.imdb, query.type, context);

  return details
    ? {
        provider: PROVIDER_NAME,
        details,
        source: createProviderSource(details.ids),
        raw: context.debug ? details : undefined,
        confidence: 1,
      }
    : null;
}

// Searches one Cinemeta catalog type.
// Ищет один тип Cinemeta catalog.
async function searchCatalogType(
  config: CinemetaConfig,
  type: "movie" | "series",
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  const url = new URL(
    `${config.baseUrl}/catalog/${toCinemetaType(type)}/top/search=${encodeURIComponent(
      query.title ?? "",
    )}.json`,
  );
  const response = await requestJson<CinemetaCatalogResponse>(config, url, context);
  const items = (response.metas ?? [])
    .map((meta) => mapMetaToItem(meta, type))
    .filter((item): item is MediaItem => item !== undefined)
    .filter((item) => query.year === undefined || item.year === query.year)
    .slice(0, query.limit ?? config.searchLimit);
  const enrichedItems = shouldEnrichSearchItems(query)
    ? await enrichSearchItems(config, type, items, context)
    : items;

  return enrichedItems.map((item) => createSearchResult(item, context.debug));
}

// Keeps broad title-only search responsive by avoiding extra per-item meta requests.
// Сохраняет быстрым широкий title-only поиск, избегая дополнительных meta-запросов на каждый item.
function shouldEnrichSearchItems(query: ProviderSearchQuery): boolean {
  return query.year !== undefined || Boolean(query.ids?.imdb);
}

// Enriches top search candidates with meta details when catalog search is sparse.
// Обогащает верхние search-кандидаты meta-деталями, когда catalog search возвращает мало данных.
async function enrichSearchItems(
  config: CinemetaConfig,
  type: "movie" | "series",
  items: MediaItem[],
  context: ProviderContext,
): Promise<MediaItem[]> {
  const enriched = await Promise.all(
    items.map(async (item, index) => {
      if (index >= config.enrichSearchLimit || !item.ids?.imdb || hasSearchQuality(item)) {
        return item;
      }

      try {
        const details = await getDetailsByImdbId(config, item.ids.imdb, type, context);

        return details ? detailsToItem(details) : item;
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        return item;
      }
    }),
  );

  return enriched;
}

// Checks whether a catalog item already has enough data for ranking and display.
// Проверяет, достаточно ли данных catalog item для ранжирования и отображения.
function hasSearchQuality(item: MediaItem): boolean {
  return Boolean(item.ratings?.length && item.description && item.genres?.length);
}

// Normalizes a title enough to decide whether it is broad or specific.
// Нормализует title достаточно для решения, широкий это запрос или конкретный.
// Loads one Cinemeta meta document.
// Загружает один Cinemeta meta document.
async function getDetailsByImdbId(
  config: CinemetaConfig,
  imdbId: string,
  type: ProviderDetailsQuery["type"],
  context: ProviderContext,
): Promise<MediaDetails | null> {
  const types =
    type === "movie" || type === "series"
      ? [type]
      : type === "anime"
        ? (["series"] as const)
        : (["movie", "series"] as const);
  const loadType = (currentType: "movie" | "series") =>
    loadDetailsType(config, imdbId, currentType, context);

  if (types.length === 1) {
    return resolveDetailsOutcomes([await loadType(types[0]!)]);
  }

  const outcomes = await Promise.all(types.map(loadType));

  return resolveDetailsOutcomes(outcomes);
}

type CinemetaDetailsOutcome =
  | { status: "found"; details: MediaDetails }
  | { status: "not_found" }
  | { status: "failed"; error: unknown };

// Loads one Cinemeta type while keeping confirmed absence distinct from request failures.
// Загружает один тип Cinemeta, не смешивая подтвержденное отсутствие со сбоем запроса.
async function loadDetailsType(
  config: CinemetaConfig,
  imdbId: string,
  type: "movie" | "series",
  context: ProviderContext,
): Promise<CinemetaDetailsOutcome> {
  const url = new URL(`${config.baseUrl}/meta/${toCinemetaType(type)}/${imdbId}.json`);

  try {
    const response = await requestJson<CinemetaMetaResponse>(config, url, context);
    const details = response.meta ? metaToDetails(config, response.meta, type) : null;

    return details ? { status: "found", details } : { status: "not_found" };
  } catch (error) {
    rethrowIfProviderAborted(context, error);

    return getProviderHttpStatus(error) === 404
      ? { status: "not_found" }
      : { status: "failed", error };
  }
}

// Returns any available details and propagates degradation only when nothing was found.
// Возвращает найденные details и пробрасывает деградацию, только если результата нет.
function resolveDetailsOutcomes(outcomes: CinemetaDetailsOutcome[]): MediaDetails | null {
  const found = outcomes.find(
    (outcome): outcome is Extract<CinemetaDetailsOutcome, { status: "found" }> =>
      outcome.status === "found",
  );

  if (found) {
    return found.details;
  }

  const failures = outcomes.filter(
    (outcome): outcome is Extract<CinemetaDetailsOutcome, { status: "failed" }> =>
      outcome.status === "failed",
  );
  const retryable = failures.find(
    (outcome) => outcome.error instanceof ProviderError && outcome.error.retryable,
  );
  const failure = retryable ?? failures[0];

  if (failure) {
    throw failure.error;
  }

  return null;
}

// Maps Cinemeta summary into compact MediaItem.
// Мапит Cinemeta summary в compact MediaItem.
function mapMetaToItem(meta: CinemetaMetaSummary, type: "movie" | "series"): MediaItem | undefined {
  const imdbId = meta.imdb_id ?? meta.id;
  const title = meta.name;

  if (!imdbId || !title) {
    return undefined;
  }

  const ids = createIds(meta, imdbId);

  return {
    id: `${PROVIDER_NAME}-${type}-${imdbId}`,
    type,
    title,
    year: getYear(meta.releaseInfo),
    description: meta.description,
    poster: createProviderImage(meta.poster, "poster", PROVIDER_NAME),
    backdrop: createProviderImage(meta.background, "backdrop", PROVIDER_NAME),
    genres: mapGenreNames(meta.genre ?? meta.genres, PROVIDER_NAME),
    ratings: mapRating(meta.imdbRating),
    ids,
  };
}

// Converts Cinemeta meta details into movie or series details.
// Преобразует Cinemeta meta details в movie или series details.
function metaToDetails(
  config: CinemetaConfig,
  meta: CinemetaMetaDetails,
  type: "movie" | "series",
): MediaDetails | null {
  const item = mapMetaToItem(meta, type);

  if (!item) {
    return null;
  }

  const detailsBase = {
    ...item,
    runtimeMinutes: parseRuntime(meta.runtime),
    countries: parseList(meta.country),
    images: [item.poster, item.backdrop]
      .filter((image): image is Image => Boolean(image))
      .slice(0, config.imageLimit),
    persons: mapPersons(meta, config.personLimit),
    sourceProviders: [createProviderSource(item.ids)],
  };

  return type === "series"
    ? ({
        ...detailsBase,
        type: "series",
        status: mapStatus(meta.status),
        episodesCount: countSeriesEpisodes(meta.videos),
        seasonsCount: countSeriesSeasons(meta.videos),
      } satisfies SeriesDetails)
    : ({ ...detailsBase, type: "movie" } satisfies MovieDetails);
}

// Creates a provider search result with source attribution.
// Создает provider search result с source attribution.
function createSearchResult(item: MediaItem, debug: boolean | undefined): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    source: createProviderSource(item.ids),
    raw: debug ? item : undefined,
    confidence: item.ids?.imdb ? 0.95 : 0.8,
  };
}

// Converts details back to a search result for IMDb ID search.
// Преобразует details обратно в search result для поиска по IMDb ID.
function detailsToSearchResult(
  details: MediaDetails,
  debug: boolean | undefined,
): ProviderSearchResult {
  return createSearchResult(detailsToItem(details), debug);
}

// Converts details into the compact search item shape.
// Преобразует details в компактную форму search item.
function detailsToItem(details: MediaDetails): MediaItem {
  return {
    id: details.id,
    type: details.type,
    title: details.title,
    year: details.year,
    description: details.description,
    poster: details.poster,
    backdrop: details.backdrop,
    genres: details.genres,
    ratings: details.ratings,
    ids: details.ids,
  };
}

// Creates normalized external IDs from Cinemeta IDs.
// Создает normalized external IDs из Cinemeta IDs.
function createIds(meta: CinemetaMetaSummary, imdbId: string): ExternalIds {
  return {
    imdb: imdbId,
    tmdb: meta.moviedb_id ? String(meta.moviedb_id) : undefined,
  };
}

// Creates source attribution for Cinemeta results.
// Создает source attribution для результатов Cinemeta.
function createProviderSource(ids: ExternalIds | undefined): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: normalizeProviderOutputUrl(
      ids?.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : undefined,
    ),
  };
}

// Maps IMDb rating from Cinemeta into normalized rating.
// Мапит IMDb rating из Cinemeta в normalized rating.
function mapRating(value: string | undefined): Rating[] | undefined {
  const parsed = value ? Number(value) : undefined;

  return parsed && Number.isFinite(parsed)
    ? [
        {
          source: "imdb",
          value: parsed,
          max: 10,
        },
      ]
    : undefined;
}

// Maps simple people arrays into normalized persons.
// Мапит простые people arrays в normalized persons.
function mapPersons(meta: CinemetaMetaDetails, limit: number): MediaDetails["persons"] {
  const directors = (meta.director ?? []).map((name) => ({
    person: { name },
    roles: ["director" as const],
  }));
  const writers = (meta.writer ?? []).map((name) => ({
    person: { name },
    roles: ["writer" as const],
  }));
  const actors = (meta.cast ?? []).map((name, order) => ({
    person: { name },
    roles: ["actor" as const],
    order,
  }));

  const persons = [...directors, ...writers, ...actors].slice(0, limit);

  return persons.length ? persons : undefined;
}

// Requests JSON through the shared provider HTTP helper.
// Запрашивает JSON через общий provider HTTP helper.
function requestJson<T>(config: CinemetaConfig, url: URL, context: ProviderContext): Promise<T> {
  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    init: {
      headers: {
        accept: "application/json",
      },
    },
  });
}

// Converts normalized media type to Cinemeta route type.
// Конвертирует normalized media type в Cinemeta route type.
function toCinemetaType(type: "movie" | "series"): "movie" | "series" {
  return type;
}

// Extracts the first four-digit year from Cinemeta release info.
// Достает первый четырехзначный год из Cinemeta release info.
function getYear(value: string | undefined): number | undefined {
  const match = value?.match(/\d{4}/);

  return match ? Number(match[0]) : undefined;
}

// Parses the first runtime number from Cinemeta runtime text.
// Парсит первое число runtime из Cinemeta runtime text.
function parseRuntime(runtime: string | undefined): number | undefined {
  const match = runtime?.match(/\d+/);

  return match ? Number(match[0]) : undefined;
}

// Splits comma-separated Cinemeta values into normalized strings.
// Разбивает comma-separated Cinemeta values в normalized strings.
function parseList(value: string | undefined): string[] | undefined {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Maps Cinemeta lifecycle status into the core status vocabulary.
// Мапит lifecycle status Cinemeta в словарь status из core.
function mapStatus(status: string | undefined): MediaStatus | undefined {
  switch (status?.toLowerCase()) {
    case "ended":
      return "ended";
    case "returning series":
      return "ongoing";
    case "in production":
      return "in_production";
    case "planned":
    case "pilot":
      return "announced";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return undefined;
  }
}

// Counts regular series episodes while ignoring specials from season 0.
// Считает обычные эпизоды сериала, игнорируя specials из season 0.
function countSeriesEpisodes(videos: CinemetaVideo[] | undefined): number | undefined {
  const count = videos?.filter((video) => isRegularEpisode(video)).length ?? 0;

  return count > 0 ? count : undefined;
}

// Counts seasons that contain regular episodes.
// Считает сезоны, в которых есть обычные эпизоды.
function countSeriesSeasons(videos: CinemetaVideo[] | undefined): number | undefined {
  const seasons = new Set(
    videos
      ?.filter((video) => isRegularEpisode(video))
      .map((video) => video.season)
      .filter((season): season is number => typeof season === "number" && season > 0),
  );

  return seasons.size > 0 ? seasons.size : undefined;
}

// Checks whether a Cinemeta video is a regular numbered episode.
// Проверяет, является ли Cinemeta video обычным номерным эпизодом.
function isRegularEpisode(video: CinemetaVideo): boolean {
  return (
    typeof video.season === "number" &&
    video.season > 0 &&
    (typeof video.number === "number" || typeof video.episode === "number")
  );
}

// Removes trailing slashes so URL paths are built consistently.
// Убирает trailing slashes, чтобы URL paths собирались одинаково.
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
