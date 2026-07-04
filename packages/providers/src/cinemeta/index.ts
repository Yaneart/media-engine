import type {
  ExternalIds,
  Genre,
  Image,
  MediaDetails,
  MediaItem,
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
import { type MediaProvider } from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "cinemeta";
const DEFAULT_BASE_URL = "https://v3-cinemeta.strem.io";
const DEFAULT_SEARCH_LIMIT = 10;

// Options used to create a Cinemeta metadata provider.
// Опции для создания metadata-провайдера Cinemeta.
export interface CinemetaProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
}

// Creates a no-token movie and series provider backed by the public Cinemeta addon API.
// Создает no-token provider фильмов и сериалов на публичном Cinemeta addon API.
export function cinemetaProvider(options: CinemetaProviderOptions = {}): MediaProvider {
  const config = createCinemetaConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
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
  searchLimit: number;
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
}

// Builds provider config from public options.
// Собирает конфигурацию provider из публичных options.
function createCinemetaConfig(options: CinemetaProviderOptions): CinemetaConfig {
  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch,
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
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

  return results
    .flat()
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, query.limit ?? config.searchLimit);
}

// Loads Cinemeta details by IMDb ID.
// Загружает Cinemeta details по IMDb ID.
async function getCinemetaDetails(
  config: CinemetaConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (!query.ids?.imdb || query.type === "anime") {
    return null;
  }

  const details = await getDetailsByImdbId(config, query.ids.imdb, query.type, context);

  return details
    ? {
        provider: PROVIDER_NAME,
        details,
        source: createProviderSource(details.type, details.ids),
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

  return (response.metas ?? [])
    .map((meta) => mapMetaToItem(meta, type))
    .filter((item): item is MediaItem => item !== undefined)
    .filter((item) => query.year === undefined || item.year === query.year)
    .map((item) => createSearchResult(item, context.debug));
}

// Loads one Cinemeta meta document.
// Загружает один Cinemeta meta document.
async function getDetailsByImdbId(
  config: CinemetaConfig,
  imdbId: string,
  type: ProviderDetailsQuery["type"],
  context: ProviderContext,
): Promise<MediaDetails | null> {
  const types = type === "movie" || type === "series" ? [type] : (["movie", "series"] as const);

  for (const currentType of types) {
    const url = new URL(`${config.baseUrl}/meta/${toCinemetaType(currentType)}/${imdbId}.json`);
    const response = await requestJson<CinemetaMetaResponse>(config, url, context);

    if (response.meta) {
      return metaToDetails(response.meta, currentType);
    }
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
    poster: createImage(meta.poster, "poster"),
    backdrop: createImage(meta.background, "backdrop"),
    genres: mapGenres(meta.genre ?? meta.genres),
    ratings: mapRating(meta.imdbRating),
    ids,
  };
}

// Converts Cinemeta meta details into movie or series details.
// Преобразует Cinemeta meta details в movie или series details.
function metaToDetails(meta: CinemetaMetaDetails, type: "movie" | "series"): MediaDetails | null {
  const item = mapMetaToItem(meta, type);

  if (!item) {
    return null;
  }

  const detailsBase = {
    ...item,
    runtimeMinutes: parseRuntime(meta.runtime),
    countries: parseList(meta.country),
    images: [item.poster, item.backdrop].filter((image): image is Image => Boolean(image)),
    persons: mapPersons(meta),
    sourceProviders: [createProviderSource(type, item.ids)],
  };

  return type === "series"
    ? ({ ...detailsBase, type: "series" } satisfies SeriesDetails)
    : ({ ...detailsBase, type: "movie" } satisfies MovieDetails);
}

// Creates a provider search result with source attribution.
// Создает provider search result с source attribution.
function createSearchResult(item: MediaItem, debug: boolean | undefined): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    source: createProviderSource(item.type, item.ids),
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
  return createSearchResult(
    {
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
    },
    debug,
  );
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
function createProviderSource(
  type: MediaItem["type"],
  ids: ExternalIds | undefined,
): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: ids?.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : undefined,
  };
}

// Maps genre labels into normalized genre objects.
// Мапит genre labels в normalized genre objects.
function mapGenres(genres: string[] | undefined): Genre[] | undefined {
  return genres?.map((genre) => ({
    name: genre,
    source: PROVIDER_NAME,
  }));
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
function mapPersons(meta: CinemetaMetaDetails): MediaDetails["persons"] {
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

  return [...directors, ...writers, ...actors];
}

function createImage(url: string | undefined, type: Image["type"]): Image | undefined {
  return url
    ? {
        url,
        type,
        source: PROVIDER_NAME,
      }
    : undefined;
}

// Requests JSON through the shared provider HTTP helper.
// Запрашивает JSON через общий provider HTTP helper.
function requestJson<T>(config: CinemetaConfig, url: URL, context: ProviderContext): Promise<T> {
  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    context,
    fetch: config.fetch,
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

// Removes trailing slashes so URL paths are built consistently.
// Убирает trailing slashes, чтобы URL paths собирались одинаково.
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
