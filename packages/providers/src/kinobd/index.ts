import type {
  ExternalIds,
  Genre,
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
  SeriesDetails,
} from "@media-engine/core";
import { type MediaProvider } from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "kinobd";
const DEFAULT_BASE_URL = "https://kinobd.net";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_IMAGE_LIMIT = 20;
const DEFAULT_PERSON_LIMIT = 30;

// Options used to create a no-token KinoBD metadata provider.
// Опции для создания no-token metadata-провайдера KinoBD.
export interface KinoBdProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
  imageLimit?: number;
  personLimit?: number;
}

// Creates a movie and series provider backed by the public KinoBD API used by ReYohoho.
// Создает provider фильмов и сериалов на публичном KinoBD API, который использует ReYohoho.
export function kinobdProvider(options: KinoBdProviderOptions = {}): MediaProvider {
  const config = createKinoBdConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie", "series"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb", "kinopoisk"],
      },
      details: {
        byExternalIds: ["imdb", "kinopoisk"],
      },
      features: ["posters", "ratings", "genres", "persons"],
    },
    async search(query, context) {
      return searchKinoBd(config, query, context);
    },
    async getDetails(query, context) {
      return getKinoBdDetails(config, query, context);
    },
  };
}

// Internal normalized KinoBD provider configuration.
// Внутренняя нормализованная конфигурация KinoBD provider.
interface KinoBdConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  searchLimit: number;
  imageLimit: number;
  personLimit: number;
}

interface KinoBdSearchResponse {
  data?: KinoBdTitle[];
}

interface KinoBdTitle {
  id?: number;
  kinopoisk_id?: number;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  name_original?: string | null;
  name_russian?: string | null;
  year?: string | number | null;
  year_start?: string | number | null;
  year_end?: string | number | null;
  rating_kp?: number | string | null;
  rating_kp_count?: number | string | null;
  rating_imdb?: number | string | null;
  rating_imdb_count?: number | string | null;
  description?: string | null;
  country_ru?: string | null;
  type?: string | null;
  premiere_ru?: string | null;
  premiere_world?: string | null;
  time_minutes?: number | string | null;
  small_poster?: string | null;
  big_poster?: string | null;
  popular_rate?: number | string | null;
  popularity?: {
    popular_rate?: number | string | null;
  } | null;
  persons?: KinoBdPerson[];
  genres?: KinoBdGenre[];
  countries?: KinoBdCountry[];
  images?: KinoBdImage[];
}

interface KinoBdPerson {
  id?: number;
  name_english?: string | null;
  name_russian?: string | null;
  kinopoisk_id?: number | null;
  profession?: {
    profession_id?: string | null;
  } | null;
}

interface KinoBdGenre {
  id?: number;
  name_ru?: string | null;
}

interface KinoBdCountry {
  name_ru?: string | null;
}

interface KinoBdImage {
  type?: string | null;
  width?: number | null;
  height?: number | null;
  src?: string | null;
}

// Builds provider config with conservative defaults for the public KinoBD API.
// Собирает конфигурацию с консервативными defaults для публичного KinoBD API.
function createKinoBdConfig(options: KinoBdProviderOptions): KinoBdConfig {
  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch,
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    imageLimit: options.imageLimit ?? DEFAULT_IMAGE_LIMIT,
    personLimit: options.personLimit ?? DEFAULT_PERSON_LIMIT,
  };
}

// Runs title, IMDb ID, or Kinopoisk ID search through KinoBD.
// Выполняет поиск по названию, IMDb ID или Kinopoisk ID через KinoBD.
async function searchKinoBd(
  config: KinoBdConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type === "anime") {
    return [];
  }

  const titles = await loadKinoBdTitles(config, query, context, false);
  const normalizedTitle = normalizeSearchText(query.title ?? "");

  return titles
    .map((title) => ({
      title,
      item: mapTitleToItem(title),
      score: scoreTitle(title, query, normalizedTitle),
    }))
    .filter((entry): entry is { title: KinoBdTitle; item: MediaItem; score: number } =>
      Boolean(entry.item),
    )
    .filter((entry) => query.year === undefined || entry.item.year === query.year)
    .filter((entry) => matchesType(entry.item.type, query.type))
    .sort((left, right) => right.score - left.score)
    .slice(0, query.limit ?? config.searchLimit)
    .map((entry) => createSearchResult(entry.item, entry.title, context.debug, entry.score));
}

// Loads details by strong external IDs.
// Загружает details по сильным внешним ID.
async function getKinoBdDetails(
  config: KinoBdConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (query.type === "anime" || (!query.ids?.kinopoisk && !query.ids?.imdb)) {
    return null;
  }

  const [title] = await loadKinoBdTitles(config, query, context, true);
  const details = title ? mapTitleToDetails(config, title) : null;

  return details
    ? {
        provider: PROVIDER_NAME,
        details,
        source: createProviderSource(details.ids),
        raw: context.debug ? title : undefined,
        confidence: 1,
      }
    : null;
}

// Loads KinoBD records from the matching search endpoint.
// Загружает records KinoBD из подходящего search endpoint.
async function loadKinoBdTitles(
  config: KinoBdConfig,
  query: ProviderSearchQuery | ProviderDetailsQuery,
  context: ProviderContext,
  includeRelations: boolean,
): Promise<KinoBdTitle[]> {
  const imdbId = query.ids?.imdb;
  const kinopoiskId = query.ids?.kinopoisk;

  if (imdbId) {
    return requestSearch(config, "imdb_id", imdbId, context, includeRelations);
  }

  if (kinopoiskId) {
    return requestSearch(config, "kp_id", kinopoiskId, context, includeRelations);
  }

  if ("title" in query && query.title?.trim()) {
    return requestSearch(config, "title", query.title, context, includeRelations);
  }

  return [];
}

// Requests one KinoBD search endpoint and returns the data array.
// Запрашивает один KinoBD search endpoint и возвращает data array.
async function requestSearch(
  config: KinoBdConfig,
  mode: "title" | "imdb_id" | "kp_id",
  value: string,
  context: ProviderContext,
  includeRelations: boolean,
): Promise<KinoBdTitle[]> {
  const url = new URL(`${config.baseUrl}/api/films/search/${mode}`);

  url.searchParams.set("q", value);
  url.searchParams.set("page", "1");

  if (includeRelations) {
    url.searchParams.set("with", "persons,genres,countries,popularity,images");
  }

  const response = await fetchJson<KinoBdSearchResponse>({
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

  return response.data ?? [];
}

// Maps a KinoBD record into a compact MediaItem.
// Мапит KinoBD record в compact MediaItem.
function mapTitleToItem(title: KinoBdTitle): MediaItem | undefined {
  const type = mapMediaType(title.type);
  const displayTitle = title.name_russian ?? title.name_original;

  if (!type || !displayTitle || !title.id) {
    return undefined;
  }

  return {
    id: `${PROVIDER_NAME}-${title.id}`,
    type,
    title: displayTitle,
    originalTitle: title.name_original ?? undefined,
    alternativeTitles: mapAlternativeTitles(title),
    year: parseNumber(title.year ?? title.year_start),
    releaseDate: title.premiere_ru ?? title.premiere_world ?? undefined,
    description: title.description ?? undefined,
    poster: createImage(title.big_poster ?? title.small_poster, "poster"),
    genres: mapGenres(title.genres),
    ratings: mapRatings(title),
    ids: createIds(title),
  };
}

// Converts a KinoBD record into detailed movie or series metadata.
// Преобразует KinoBD record в detailed metadata фильма или сериала.
function mapTitleToDetails(config: KinoBdConfig, title: KinoBdTitle): MediaDetails | null {
  const item = mapTitleToItem(title);

  if (!item) {
    return null;
  }

  const detailsBase = {
    ...item,
    runtimeMinutes: parseNumber(title.time_minutes),
    countries: mapCountries(title),
    images: mapImages(title, config.imageLimit),
    persons: mapPersons(title.persons, config.personLimit),
    sourceProviders: [createProviderSource(item.ids)],
  };

  return item.type === "series"
    ? ({ ...detailsBase, type: "series" } satisfies SeriesDetails)
    : ({ ...detailsBase, type: "movie" } satisfies MovieDetails);
}

// Creates a provider search result with confidence derived from score.
// Создает provider search result с confidence, полученным из score.
function createSearchResult(
  item: MediaItem,
  title: KinoBdTitle,
  debug: boolean | undefined,
  score: number,
): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    source: createProviderSource(item.ids),
    raw: debug ? title : undefined,
    confidence: Math.min(1, Math.max(0.2, score / 100)),
  };
}

// Scores KinoBD records so exact popular movie matches beat loose title noise.
// Оценивает KinoBD records, чтобы точные популярные фильмы были выше шумных совпадений.
function scoreTitle(
  title: KinoBdTitle,
  query: ProviderSearchQuery,
  normalizedTitle: string,
): number {
  if (query.ids?.imdb || query.ids?.kinopoisk) {
    return 100;
  }

  const original = normalizeSearchText(title.name_original ?? "");
  const russian = normalizeSearchText(title.name_russian ?? "");
  const popularity = parseNumber(title.popular_rate ?? title.popularity?.popular_rate) ?? 0;
  const votes = parseNumber(title.rating_kp_count) ?? parseNumber(title.rating_imdb_count) ?? 0;
  const rating = parseNumber(title.rating_kp) ?? parseNumber(title.rating_imdb) ?? 0;
  let score = 10;

  if (normalizedTitle && (original === normalizedTitle || russian === normalizedTitle)) {
    score += 65;
  } else if (
    normalizedTitle &&
    (original.includes(normalizedTitle) || russian.includes(normalizedTitle))
  ) {
    score += 30;
  }

  if (title.imdb_id) {
    score += 5;
  }

  if (title.kinopoisk_id) {
    score += 5;
  }

  score += Math.min(10, rating);
  score += Math.min(12, Math.log10(votes + 1) * 2);
  score += Math.min(12, Math.log10(popularity + 1) * 2);

  return score;
}

// Maps KinoBD type strings into Media Engine media types.
// Мапит type strings KinoBD в Media Engine media types.
function mapMediaType(type: string | null | undefined): MediaType | undefined {
  if (type === "film") {
    return "movie";
  }

  if (type === "serial" || type === "series") {
    return "series";
  }

  return undefined;
}

// Checks whether a mapped type satisfies an optional query type.
// Проверяет, подходит ли mapped type под optional query type.
function matchesType(itemType: MediaType, queryType: MediaType | undefined): boolean {
  return queryType === undefined || itemType === queryType;
}

// Creates normalized external IDs from KinoBD fields.
// Создает normalized external IDs из полей KinoBD.
function createIds(title: KinoBdTitle): ExternalIds {
  return {
    imdb: title.imdb_id ?? undefined,
    tmdb: title.tmdb_id ? String(title.tmdb_id) : undefined,
    kinopoisk: title.kinopoisk_id ? String(title.kinopoisk_id) : undefined,
  };
}

// Creates source attribution for KinoBD records.
// Создает source attribution для KinoBD records.
function createProviderSource(ids: ExternalIds | undefined): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: ids?.kinopoisk ? `https://www.kinopoisk.ru/film/${ids.kinopoisk}/` : undefined,
  };
}

// Maps KinoBD ratings into normalized rating values.
// Мапит KinoBD ratings в normalized rating values.
function mapRatings(title: KinoBdTitle): Rating[] | undefined {
  const ratings = [
    createRating("kinopoisk", title.rating_kp, title.rating_kp_count),
    createRating("imdb", title.rating_imdb, title.rating_imdb_count),
  ].filter((rating): rating is Rating => Boolean(rating));

  return ratings.length ? ratings : undefined;
}

// Creates one normalized rating if the value is valid.
// Создает один normalized rating, если значение валидно.
function createRating(
  source: Rating["source"],
  value: number | string | null | undefined,
  votes: number | string | null | undefined,
): Rating | undefined {
  const parsedValue = parseNumber(value);

  return parsedValue === undefined
    ? undefined
    : {
        source,
        value: parsedValue,
        max: 10,
        votes: parseNumber(votes),
      };
}

// Maps KinoBD genre records into normalized genres.
// Мапит KinoBD genre records в normalized genres.
function mapGenres(genres: KinoBdGenre[] | undefined): Genre[] | undefined {
  const mapped = genres
    ?.map((genre): Genre | undefined =>
      genre.name_ru
        ? {
            id: genre.id ? String(genre.id) : undefined,
            name: genre.name_ru,
            source: PROVIDER_NAME,
          }
        : undefined,
    )
    .filter((genre): genre is Genre => Boolean(genre));

  return mapped?.length ? mapped : undefined;
}

// Maps country relation records or fallback comma-separated country text.
// Мапит country relation records или fallback comma-separated country text.
function mapCountries(title: KinoBdTitle): string[] | undefined {
  const countries = title.countries?.map((country) => country.name_ru).filter(isStringValue);

  return countries?.length ? countries : parseList(title.country_ru);
}

// Maps KinoBD image records and poster fallbacks into normalized images.
// Мапит KinoBD image records и poster fallbacks в normalized images.
function mapImages(title: KinoBdTitle, limit: number): Image[] | undefined {
  const images = [
    createImage(title.big_poster, "poster"),
    ...(title.images ?? []).map(mapKinoBdImage),
  ]
    .filter((image): image is Image => Boolean(image))
    .slice(0, limit);

  return images.length ? images : undefined;
}

// Maps one KinoBD image relation into normalized image metadata.
// Мапит одну KinoBD image relation в normalized image metadata.
function mapKinoBdImage(image: KinoBdImage): Image | undefined {
  const type = image.type?.startsWith("kadr") ? "still" : image.type === "logo" ? "logo" : "poster";

  return image.src
    ? {
        url: image.src,
        type,
        width: image.width ?? undefined,
        height: image.height ?? undefined,
        source: PROVIDER_NAME,
      }
    : undefined;
}

// Maps KinoBD persons and profession IDs into normalized media persons.
// Мапит KinoBD persons и profession IDs в normalized media persons.
function mapPersons(persons: KinoBdPerson[] | undefined, limit: number): MediaPerson[] | undefined {
  const mapped = persons
    ?.map((person, order): MediaPerson | undefined => {
      const name = person.name_russian ?? person.name_english;
      const role = mapPersonRole(person.profession?.profession_id);

      return name
        ? {
            person: {
              id: person.id ? String(person.id) : undefined,
              name,
              originalName: person.name_english ?? undefined,
              ids: {
                kinopoisk: person.kinopoisk_id ? String(person.kinopoisk_id) : undefined,
              },
            },
            roles: [role],
            order,
          }
        : undefined;
    })
    .filter((person): person is MediaPerson => Boolean(person))
    .slice(0, limit);

  return mapped?.length ? mapped : undefined;
}

// Maps KinoBD profession identifiers into Media Engine roles.
// Мапит KinoBD profession identifiers в Media Engine roles.
function mapPersonRole(profession: string | null | undefined): PersonRole {
  if (profession === "actor") {
    return "actor";
  }

  if (profession === "director") {
    return "director";
  }

  if (profession === "producer") {
    return "producer";
  }

  if (profession === "writer") {
    return "writer";
  }

  return "unknown";
}

// Creates a normalized image from a direct URL.
// Создает normalized image из direct URL.
function createImage(url: string | null | undefined, type: Image["type"]): Image | undefined {
  return url
    ? {
        url,
        type,
        source: PROVIDER_NAME,
      }
    : undefined;
}

// Adds original and localized titles when they differ.
// Добавляет original и localized titles, когда они отличаются.
function mapAlternativeTitles(title: KinoBdTitle): string[] | undefined {
  const titles = [title.name_original, title.name_russian]
    .filter(isStringValue)
    .filter((value, index, values) => values.indexOf(value) === index);

  return titles.length > 1 ? titles : undefined;
}

// Parses numbers from KinoBD string or number fields.
// Парсит числа из string или number полей KinoBD.
function parseNumber(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

// Splits comma-separated strings into clean values.
// Разбивает comma-separated strings в чистые значения.
function parseList(value: string | null | undefined): string[] | undefined {
  const list = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return list?.length ? list : undefined;
}

// Normalizes search text for simple title scoring.
// Нормализует search text для простого title scoring.
function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

// Checks whether a value is a non-empty string.
// Проверяет, является ли значение непустой строкой.
function isStringValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

// Removes trailing slashes so URL paths are built consistently.
// Убирает trailing slashes, чтобы URL paths собирались одинаково.
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
