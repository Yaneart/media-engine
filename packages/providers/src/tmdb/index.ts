import type {
  ExternalIds,
  Image,
  MediaDetails,
  MediaItem,
  MediaPerson,
  MediaType,
  MovieDetails,
  PersonRole,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
  Season,
  SeriesDetails,
} from "@media-engine/core";
import { ProviderError, type MediaProvider } from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "tmdb";
const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const DEFAULT_LANGUAGE = "en-US";
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PERSON_LIMIT = 20;

// Options used to create a TMDB metadata provider.
// Опции для создания metadata-провайдера TMDB.
export interface TmdbProviderOptions {
  apiKey: string;
  language?: string;
  baseUrl?: string;
  imageBaseUrl?: string;
  includeAdult?: boolean;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
  personLimit?: number;
}

// Creates a TMDB metadata provider for movie and series data.
// Создает metadata-провайдер TMDB для данных фильмов и сериалов.
export function tmdbProvider(options: TmdbProviderOptions): MediaProvider {
  const config = createTmdbConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie", "series"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb", "tmdb"],
      },
      details: {
        byExternalIds: ["imdb", "tmdb"],
      },
      features: [
        "posters",
        "backdrops",
        "ratings",
        "genres",
        "persons",
        "seasons",
        "alternative_titles",
      ],
    },
    async search(query, context) {
      return searchTmdb(config, query, context);
    },
    async getDetails(query, context) {
      return getTmdbDetails(config, query, context);
    },
  };
}

// Internal normalized TMDB provider configuration.
// Внутренняя нормализованная конфигурация TMDB-провайдера.
interface TmdbConfig {
  apiKey: string;
  language: string;
  baseUrl: string;
  imageBaseUrl: string;
  includeAdult: boolean;
  fetch?: ProviderFetch;
  searchLimit: number;
  personLimit: number;
}

interface TmdbSearchResponse<T> {
  results?: T[];
}

interface TmdbFindResponse {
  movie_results?: TmdbMovieSearchResult[];
  tv_results?: TmdbTvSearchResult[];
}

interface TmdbGenre {
  id: number;
  name: string;
}

interface TmdbMovieSearchResult {
  id: number;
  title?: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
}

interface TmdbTvSearchResult {
  id: number;
  name?: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
}

interface TmdbMovieDetailsResponse extends TmdbMovieSearchResult {
  status?: string;
  runtime?: number;
  genres?: TmdbGenre[];
  imdb_id?: string | null;
  budget?: number;
  revenue?: number;
  original_language?: string;
  production_countries?: Array<{ iso_3166_1?: string; name?: string }>;
  belongs_to_collection?: {
    id?: number;
    name?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
  } | null;
  credits?: TmdbCreditsResponse;
  external_ids?: TmdbExternalIdsResponse;
  images?: TmdbImagesResponse;
  alternative_titles?: { titles?: Array<{ title?: string }> };
}

interface TmdbTvDetailsResponse extends TmdbTvSearchResult {
  status?: string;
  episode_run_time?: number[];
  genres?: TmdbGenre[];
  original_language?: string;
  origin_country?: string[];
  number_of_episodes?: number;
  number_of_seasons?: number;
  seasons?: TmdbSeasonResponse[];
  credits?: TmdbCreditsResponse;
  external_ids?: TmdbExternalIdsResponse;
  images?: TmdbImagesResponse;
  alternative_titles?: { results?: Array<{ title?: string; name?: string }> };
}

interface TmdbExternalIdsResponse {
  imdb_id?: string | null;
}

interface TmdbImagesResponse {
  posters?: TmdbImageResponse[];
  backdrops?: TmdbImageResponse[];
}

interface TmdbImageResponse {
  file_path?: string | null;
  width?: number;
  height?: number;
  iso_639_1?: string | null;
}

interface TmdbCreditsResponse {
  cast?: TmdbCastMember[];
  crew?: TmdbCrewMember[];
}

interface TmdbCastMember {
  id?: number;
  name?: string;
  original_name?: string;
  profile_path?: string | null;
  character?: string;
  order?: number;
}

interface TmdbCrewMember {
  id?: number;
  name?: string;
  original_name?: string;
  profile_path?: string | null;
  job?: string;
}

interface TmdbSeasonResponse {
  id?: number;
  season_number?: number;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  episode_count?: number;
  air_date?: string;
}

// Builds a defensive provider configuration from public options.
// Собирает защищенную конфигурацию провайдера из публичных опций.
function createTmdbConfig(options: TmdbProviderOptions): TmdbConfig {
  if (!options.apiKey.trim()) {
    throw new ProviderError({
      provider: PROVIDER_NAME,
      code: "PROVIDER_UNAUTHORIZED",
      message: "TMDB apiKey is required.",
      retryable: false,
    });
  }

  return {
    apiKey: options.apiKey,
    language: options.language ?? DEFAULT_LANGUAGE,
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    imageBaseUrl: trimTrailingSlash(options.imageBaseUrl ?? DEFAULT_IMAGE_BASE_URL),
    includeAdult: options.includeAdult ?? false,
    fetch: options.fetch,
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    personLimit: options.personLimit ?? DEFAULT_PERSON_LIMIT,
  };
}

// Runs TMDB search by title or supported external IDs.
// Выполняет поиск TMDB по названию или поддерживаемым внешним ID.
async function searchTmdb(
  config: TmdbConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.ids?.imdb) {
    const results = await findByImdbId(config, query.ids.imdb, query, context);
    return results.map((item) => createSearchResult(config, item, context.debug));
  }

  if (query.ids?.tmdb) {
    const details = await getDetailsByTmdbId(config, query.ids.tmdb, query.type, context);
    return details ? [detailsToSearchResult(config, details, context.debug)] : [];
  }

  if (!query.title || query.type === "anime") {
    return [];
  }

  const limit = query.limit ?? config.searchLimit;
  const mediaTypes = query.type ? [query.type] : (["movie", "series"] satisfies MediaType[]);
  const results: MediaItem[] = [];

  for (const mediaType of mediaTypes) {
    results.push(...(await searchByTitle(config, mediaType, query, context)));
  }

  return results.slice(0, limit).map((item) => createSearchResult(config, item, context.debug));
}

// Resolves detailed TMDB metadata by TMDB ID or IMDb ID.
// Получает подробные metadata TMDB по TMDB ID или IMDb ID.
async function getTmdbDetails(
  config: TmdbConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  const details = query.ids?.tmdb
    ? await getDetailsByTmdbId(config, query.ids.tmdb, query.type, context)
    : await getDetailsByImdbId(config, query, context);

  if (!details) {
    return null;
  }

  return {
    provider: PROVIDER_NAME,
    details,
    source: createProviderSource(details.type, details.ids),
    raw: context.debug ? details : undefined,
  };
}

// Searches TMDB movie or TV endpoint by title.
// Ищет в TMDB movie или TV endpoint по названию.
async function searchByTitle(
  config: TmdbConfig,
  mediaType: MediaType,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<MediaItem[]> {
  if (mediaType === "movie") {
    const response = await requestTmdb<TmdbSearchResponse<TmdbMovieSearchResult>>(
      config,
      "/search/movie",
      {
        query: query.title,
        language: query.language ?? context.language ?? config.language,
        include_adult: String(config.includeAdult),
        year: query.year ? String(query.year) : undefined,
        primary_release_year: query.year ? String(query.year) : undefined,
      },
      context,
    );

    return (response.results ?? []).map((item) => mapMovieSearchResult(config, item));
  }

  if (mediaType === "series") {
    const response = await requestTmdb<TmdbSearchResponse<TmdbTvSearchResult>>(
      config,
      "/search/tv",
      {
        query: query.title,
        language: query.language ?? context.language ?? config.language,
        include_adult: String(config.includeAdult),
        year: query.year ? String(query.year) : undefined,
        first_air_date_year: query.year ? String(query.year) : undefined,
      },
      context,
    );

    return (response.results ?? []).map((item) => mapTvSearchResult(config, item));
  }

  return [];
}

// Finds TMDB movie and TV items through an IMDb external ID.
// Находит TMDB фильмы и сериалы через внешний IMDb ID.
async function findByImdbId(
  config: TmdbConfig,
  imdbId: string,
  query: ProviderSearchQuery | ProviderDetailsQuery,
  context: ProviderContext,
): Promise<MediaItem[]> {
  const response = await requestTmdb<TmdbFindResponse>(
    config,
    `/find/${encodeURIComponent(imdbId)}`,
    {
      external_source: "imdb_id",
      language: query.language ?? context.language ?? config.language,
    },
    context,
  );

  const movies = query.type === "series" ? [] : (response.movie_results ?? []);
  const series = query.type === "movie" ? [] : (response.tv_results ?? []);

  return [
    ...movies.map((item) => mapMovieSearchResult(config, item, { imdb: imdbId })),
    ...series.map((item) => mapTvSearchResult(config, item, { imdb: imdbId })),
  ];
}

// Resolves details through an IMDb external ID.
// Получает детали через внешний IMDb ID.
async function getDetailsByImdbId(
  config: TmdbConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<MediaDetails | null> {
  if (!query.ids?.imdb) {
    return null;
  }

  const found = await findByImdbId(config, query.ids.imdb, query, context);
  const item = found[0];

  if (!item?.ids?.tmdb) {
    return null;
  }

  return getDetailsByTmdbId(config, item.ids.tmdb, item.type, context);
}

// Resolves details by a TMDB ID and optional media type.
// Получает детали по TMDB ID и опциональному типу медиа.
async function getDetailsByTmdbId(
  config: TmdbConfig,
  tmdbId: string,
  type: MediaType | undefined,
  context: ProviderContext,
): Promise<MediaDetails | null> {
  if (type === "series") {
    return getSeriesDetails(config, tmdbId, context);
  }

  if (type === "movie") {
    return getMovieDetails(config, tmdbId, context);
  }

  try {
    return await getMovieDetails(config, tmdbId, context);
  } catch (error) {
    if (!isTmdbNotFound(error)) {
      throw error;
    }
  }

  try {
    return await getSeriesDetails(config, tmdbId, context);
  } catch (error) {
    if (isTmdbNotFound(error)) {
      return null;
    }

    throw error;
  }
}

// Fetches and maps TMDB movie details.
// Загружает и преобразует детали фильма TMDB.
async function getMovieDetails(
  config: TmdbConfig,
  tmdbId: string,
  context: ProviderContext,
): Promise<MovieDetails> {
  const data = await requestTmdb<TmdbMovieDetailsResponse>(
    config,
    `/movie/${encodeURIComponent(tmdbId)}`,
    {
      language: context.language ?? config.language,
      append_to_response: "credits,external_ids,images,alternative_titles",
    },
    context,
  );

  return mapMovieDetails(config, data);
}

// Fetches and maps TMDB TV details.
// Загружает и преобразует детали сериала TMDB.
async function getSeriesDetails(
  config: TmdbConfig,
  tmdbId: string,
  context: ProviderContext,
): Promise<SeriesDetails> {
  const data = await requestTmdb<TmdbTvDetailsResponse>(
    config,
    `/tv/${encodeURIComponent(tmdbId)}`,
    {
      language: context.language ?? config.language,
      append_to_response: "credits,external_ids,images,alternative_titles",
    },
    context,
  );

  return mapSeriesDetails(config, data);
}

// Performs one authenticated TMDB JSON request.
// Выполняет один авторизованный JSON-запрос к TMDB.
async function requestTmdb<T>(
  config: TmdbConfig,
  path: string,
  params: Record<string, string | undefined>,
  context: ProviderContext,
): Promise<T> {
  const url = new URL(`${config.baseUrl}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    context,
    fetch: config.fetch,
    init: {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
    },
  });
}

// Maps a TMDB movie search item into Media Engine search item.
// Преобразует результат поиска фильма TMDB в search item Media Engine.
function mapMovieSearchResult(
  config: TmdbConfig,
  item: TmdbMovieSearchResult,
  extraIds: ExternalIds = {},
): MediaItem {
  return {
    id: createMediaId("movie", item.id),
    type: "movie",
    title: item.title ?? item.original_title ?? `TMDB movie ${item.id}`,
    originalTitle: item.original_title,
    year: getYear(item.release_date),
    releaseDate: item.release_date || undefined,
    description: item.overview || undefined,
    poster: createImage(config, item.poster_path, "poster"),
    backdrop: createImage(config, item.backdrop_path, "backdrop"),
    genres: (item.genre_ids ?? []).map((id) => ({
      id: String(id),
      name: String(id),
      source: PROVIDER_NAME,
    })),
    ratings: createRatings(item.vote_average, item.vote_count),
    ids: {
      ...extraIds,
      tmdb: String(item.id),
    },
  };
}

// Maps a TMDB TV search item into Media Engine search item.
// Преобразует результат поиска сериала TMDB в search item Media Engine.
function mapTvSearchResult(
  config: TmdbConfig,
  item: TmdbTvSearchResult,
  extraIds: ExternalIds = {},
): MediaItem {
  return {
    id: createMediaId("series", item.id),
    type: "series",
    title: item.name ?? item.original_name ?? `TMDB series ${item.id}`,
    originalTitle: item.original_name,
    year: getYear(item.first_air_date),
    releaseDate: item.first_air_date || undefined,
    description: item.overview || undefined,
    poster: createImage(config, item.poster_path, "poster"),
    backdrop: createImage(config, item.backdrop_path, "backdrop"),
    genres: (item.genre_ids ?? []).map((id) => ({
      id: String(id),
      name: String(id),
      source: PROVIDER_NAME,
    })),
    ratings: createRatings(item.vote_average, item.vote_count),
    ids: {
      ...extraIds,
      tmdb: String(item.id),
    },
  };
}

// Maps a TMDB movie details response into Media Engine details.
// Преобразует ответ деталей фильма TMDB в details Media Engine.
function mapMovieDetails(config: TmdbConfig, item: TmdbMovieDetailsResponse): MovieDetails {
  const ids = createIds(item.id, item.external_ids?.imdb_id ?? item.imdb_id);
  const details: MovieDetails = {
    ...mapMovieSearchResult(config, item, ids),
    type: "movie",
    genres: mapGenres(item.genres),
    status: mapStatus(item.status),
    runtimeMinutes: item.runtime,
    countries: mapCountries(item.production_countries),
    languages: item.original_language ? [item.original_language] : undefined,
    images: mapImages(config, item.images),
    persons: mapPersons(config, item.credits, config.personLimit),
    sourceProviders: [createProviderSource("movie", ids)],
    alternativeTitles: mapMovieAlternativeTitles(item.alternative_titles),
    budget: item.budget ? { amount: item.budget, currency: "USD" } : undefined,
    revenue: item.revenue ? { amount: item.revenue, currency: "USD" } : undefined,
    collection: item.belongs_to_collection?.name
      ? {
          id: item.belongs_to_collection.id ? String(item.belongs_to_collection.id) : undefined,
          title: item.belongs_to_collection.name,
          poster: createImage(config, item.belongs_to_collection.poster_path, "poster"),
          backdrop: createImage(config, item.belongs_to_collection.backdrop_path, "backdrop"),
        }
      : undefined,
  };

  return details;
}

// Maps a TMDB TV details response into Media Engine details.
// Преобразует ответ деталей TV TMDB в details Media Engine.
function mapSeriesDetails(config: TmdbConfig, item: TmdbTvDetailsResponse): SeriesDetails {
  const ids = createIds(item.id, item.external_ids?.imdb_id);
  const details: SeriesDetails = {
    ...mapTvSearchResult(config, item, ids),
    type: "series",
    genres: mapGenres(item.genres),
    status: mapStatus(item.status),
    runtimeMinutes: item.episode_run_time?.[0],
    countries: item.origin_country?.length ? item.origin_country : undefined,
    languages: item.original_language ? [item.original_language] : undefined,
    images: mapImages(config, item.images),
    persons: mapPersons(config, item.credits, config.personLimit),
    sourceProviders: [createProviderSource("series", ids)],
    alternativeTitles: mapSeriesAlternativeTitles(item.alternative_titles),
    seasons: mapSeasons(config, item.seasons),
    seasonsCount: item.number_of_seasons,
    episodesCount: item.number_of_episodes,
  };

  return details;
}

// Converts details back to provider search result for ID searches.
// Преобразует details обратно в provider search result для поиска по ID.
function detailsToSearchResult(
  config: TmdbConfig,
  details: MediaDetails,
  debug: boolean | undefined,
): ProviderSearchResult {
  return createSearchResult(
    config,
    {
      id: details.id,
      type: details.type,
      title: details.title,
      originalTitle: details.originalTitle,
      alternativeTitles: details.alternativeTitles,
      year: details.year,
      releaseDate: details.releaseDate,
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

// Creates a provider search result wrapper with attribution.
// Создает обертку provider search result с атрибуцией.
function createSearchResult(
  config: TmdbConfig,
  item: MediaItem,
  debug: boolean | undefined,
): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    source: createProviderSource(item.type, item.ids),
    raw: debug ? item : undefined,
    confidence: calculateConfidence(item),
  };
}

// Creates source attribution for TMDB results.
// Создает атрибуцию источника для результатов TMDB.
function createProviderSource(type: MediaType, ids: ExternalIds | undefined): ProviderSource {
  const tmdbId = ids?.tmdb;

  return {
    provider: PROVIDER_NAME,
    ids,
    url: tmdbId
      ? `https://www.themoviedb.org/${type === "series" ? "tv" : "movie"}/${tmdbId}`
      : undefined,
  };
}

// Creates stable internal item IDs for TMDB results.
// Создает стабильные внутренние ID элементов для результатов TMDB.
function createMediaId(type: MediaType, tmdbId: number): string {
  return `${PROVIDER_NAME}-${type}-${tmdbId}`;
}

// Creates normalized external IDs for TMDB details.
// Создает нормализованные внешние ID для деталей TMDB.
function createIds(tmdbId: number, imdbId: string | null | undefined): ExternalIds {
  return {
    tmdb: String(tmdbId),
    imdb: imdbId || undefined,
  };
}

// Creates normalized TMDB rating values.
// Создает нормализованные значения рейтинга TMDB.
function createRatings(value: number | undefined, votes: number | undefined): Rating[] | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }

  return [
    {
      source: "tmdb",
      value,
      max: 10,
      votes,
    },
  ];
}

// Creates a normalized image from a TMDB file path.
// Создает нормализованное изображение из file path TMDB.
function createImage(
  config: TmdbConfig,
  path: string | null | undefined,
  type: Image["type"],
  width?: number,
  height?: number,
  language?: string | null,
): Image | undefined {
  if (!path) {
    return undefined;
  }

  const size = type === "poster" || type === "profile" ? "w500" : "original";

  return {
    url: `${config.imageBaseUrl}/${size}${path}`,
    type,
    width,
    height,
    language: language ?? undefined,
    source: PROVIDER_NAME,
  };
}

// Maps appended TMDB image collections.
// Преобразует appended коллекции изображений TMDB.
function mapImages(
  config: TmdbConfig,
  images: TmdbImagesResponse | undefined,
): Image[] | undefined {
  const mapped = [
    ...(images?.posters ?? []).flatMap(
      (image) =>
        createImage(
          config,
          image.file_path,
          "poster",
          image.width,
          image.height,
          image.iso_639_1,
        ) ?? [],
    ),
    ...(images?.backdrops ?? []).flatMap(
      (image) =>
        createImage(
          config,
          image.file_path,
          "backdrop",
          image.width,
          image.height,
          image.iso_639_1,
        ) ?? [],
    ),
  ];

  return mapped.length ? mapped : undefined;
}

// Maps detailed TMDB genres with real names.
// Преобразует подробные жанры TMDB с реальными названиями.
function mapGenres(genres: TmdbGenre[] | undefined): MovieDetails["genres"] {
  if (!genres?.length) {
    return undefined;
  }

  return genres.map((genre) => ({
    id: String(genre.id),
    name: genre.name,
    source: PROVIDER_NAME,
  }));
}

// Maps TMDB credits into normalized persons.
// Преобразует credits TMDB в нормализованных персон.
function mapPersons(
  config: TmdbConfig,
  credits: TmdbCreditsResponse | undefined,
  limit: number,
): MediaPerson[] | undefined {
  const cast = (credits?.cast ?? []).slice(0, limit).map((member) => ({
    person: {
      id: member.id ? createPersonId(member.id) : undefined,
      name: member.name ?? member.original_name ?? "Unknown",
      originalName: member.original_name,
      photo: createImage(config, member.profile_path, "profile"),
      ids: member.id ? { tmdb: String(member.id) } : undefined,
    },
    roles: ["actor"] satisfies PersonRole[],
    characterName: member.character || undefined,
    order: member.order,
  }));

  const crew = (credits?.crew ?? [])
    .map((member) => ({
      member,
      role: mapCrewJob(member.job),
    }))
    .filter((entry): entry is { member: TmdbCrewMember; role: PersonRole } => Boolean(entry.role))
    .slice(0, limit)
    .map(({ member, role }) => ({
      person: {
        id: member.id ? createPersonId(member.id) : undefined,
        name: member.name ?? member.original_name ?? "Unknown",
        originalName: member.original_name,
        photo: createImage(config, member.profile_path, "profile"),
        ids: member.id ? { tmdb: String(member.id) } : undefined,
      },
      roles: [role],
    }));

  const persons = [...cast, ...crew];

  return persons.length ? persons : undefined;
}

// Maps a TMDB crew job into a core person role.
// Преобразует job из crew TMDB в роль core.
function mapCrewJob(job: string | undefined): PersonRole | undefined {
  switch (job) {
    case "Director":
      return "director";
    case "Writer":
    case "Screenplay":
    case "Story":
      return "writer";
    case "Producer":
    case "Executive Producer":
      return "producer";
    case "Original Music Composer":
    case "Music":
      return "composer";
    default:
      return undefined;
  }
}

// Maps TMDB seasons into normalized season metadata.
// Преобразует сезоны TMDB в нормализованные metadata сезона.
function mapSeasons(
  config: TmdbConfig,
  seasons: TmdbSeasonResponse[] | undefined,
): Season[] | undefined {
  if (!seasons?.length) {
    return undefined;
  }

  return seasons.map((season) => ({
    id: season.id ? String(season.id) : undefined,
    number: season.season_number ?? 0,
    title: season.name,
    description: season.overview || undefined,
    poster: createImage(config, season.poster_path, "poster"),
    episodesCount: season.episode_count,
    releaseDate: season.air_date || undefined,
  }));
}

// Maps TMDB status labels into core status labels.
// Преобразует status labels TMDB в status labels core.
function mapStatus(status: string | undefined): MediaDetails["status"] {
  switch (status) {
    case "Rumored":
    case "Planned":
      return "announced";
    case "In Production":
      return "in_production";
    case "Returning Series":
      return "ongoing";
    case "Released":
      return "released";
    case "Ended":
      return "ended";
    case "Canceled":
    case "Cancelled":
      return "canceled";
    default:
      return undefined;
  }
}

// Maps TMDB production countries into country names or codes.
// Преобразует production countries TMDB в названия или коды стран.
function mapCountries(
  countries: Array<{ iso_3166_1?: string; name?: string }> | undefined,
): string[] | undefined {
  if (!countries?.length) {
    return undefined;
  }

  return countries.map((country) => country.name ?? country.iso_3166_1).filter(isDefined);
}

// Maps movie alternative titles from appended TMDB data.
// Преобразует alternative titles фильма из appended данных TMDB.
function mapMovieAlternativeTitles(
  alternativeTitles: TmdbMovieDetailsResponse["alternative_titles"],
): string[] | undefined {
  const titles = (alternativeTitles?.titles ?? []).map((item) => item.title).filter(isDefined);
  return unique(titles);
}

// Maps series alternative titles from appended TMDB data.
// Преобразует alternative titles сериала из appended данных TMDB.
function mapSeriesAlternativeTitles(
  alternativeTitles: TmdbTvDetailsResponse["alternative_titles"],
): string[] | undefined {
  const titles = (alternativeTitles?.results ?? [])
    .map((item) => item.title ?? item.name)
    .filter(isDefined);

  return unique(titles);
}

// Calculates a simple confidence score from available identifiers.
// Считает простую confidence-оценку по доступным идентификаторам.
function calculateConfidence(item: MediaItem): number {
  if (item.ids?.imdb && item.ids.tmdb) {
    return 1;
  }

  if (item.ids?.tmdb) {
    return 0.9;
  }

  return 0.7;
}

// Extracts a release year from an ISO-like date string.
// Извлекает год релиза из ISO-like строки даты.
function getYear(date: string | undefined): number | undefined {
  return date ? Number(date.slice(0, 4)) || undefined : undefined;
}

// Creates a stable person ID for TMDB persons.
// Создает стабильный person ID для персон TMDB.
function createPersonId(tmdbId: number): string {
  return `${PROVIDER_NAME}-person-${tmdbId}`;
}

// Checks whether an error represents a TMDB 404 response.
// Проверяет, представляет ли ошибка 404-ответ TMDB.
function isTmdbNotFound(error: unknown): boolean {
  return error instanceof ProviderError && error.message.includes("HTTP 404");
}

// Removes trailing slash from URL-like config values.
// Удаляет завершающий slash из URL-like значений конфигурации.
function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

// Keeps only defined values in array filters.
// Оставляет только определенные значения при фильтрации массивов.
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// Returns unique string values or undefined for empty input.
// Возвращает уникальные строковые значения или undefined для пустого ввода.
function unique(values: string[]): string[] | undefined {
  const result = [...new Set(values.filter((value) => value.trim()))];
  return result.length ? result : undefined;
}
