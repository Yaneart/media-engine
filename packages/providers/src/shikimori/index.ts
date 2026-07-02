import type {
  AnimeDetails,
  AnimeKind,
  ExternalIds,
  Image,
  MediaItem,
  MediaPerson,
  MediaStatus,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
} from "@media-engine/core";
import { type MediaProvider } from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "shikimori";
const DEFAULT_BASE_URL = "https://shikimori.one";
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PERSON_LIMIT = 20;

// Options used to create a Shikimori metadata provider.
// Опции для создания metadata-провайдера Shikimori.
export interface ShikimoriProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
  personLimit?: number;
  userAgent?: string;
  censored?: boolean;
}

// Creates a Shikimori metadata provider for anime data.
// Создает metadata-провайдер Shikimori для данных аниме.
export function shikimoriProvider(options: ShikimoriProviderOptions = {}): MediaProvider {
  const config = createShikimoriConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["anime"],
      search: {
        byTitle: true,
        byExternalIds: ["shikimori"],
      },
      details: {
        byExternalIds: ["shikimori"],
      },
      features: ["posters", "ratings", "genres", "persons", "episodes", "alternative_titles"],
    },
    async search(query, context) {
      return searchShikimori(config, query, context);
    },
    async getDetails(query, context) {
      return getShikimoriDetails(config, query, context);
    },
  };
}

// Internal normalized Shikimori provider configuration.
// Внутренняя нормализованная конфигурация Shikimori-провайдера.
interface ShikimoriConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  searchLimit: number;
  personLimit: number;
  userAgent?: string;
  censored: boolean;
}

interface ShikimoriAnimeSearchResult {
  id: number;
  name?: string;
  russian?: string;
  image?: ShikimoriImageResponse;
  url?: string;
  kind?: string;
  score?: string;
  status?: string;
  episodes?: number;
  episodes_aired?: number;
  aired_on?: string;
  released_on?: string | null;
}

interface ShikimoriAnimeDetailsResponse extends ShikimoriAnimeSearchResult {
  english?: string[];
  japanese?: string[];
  synonyms?: string[];
  license_name_ru?: string | null;
  duration?: number;
  rating?: string;
  description?: string | null;
  description_html?: string | null;
  description_source?: string | null;
  franchise?: string | null;
  favoured?: boolean;
  anons?: boolean;
  ongoing?: boolean;
  thread_id?: number;
  topic_id?: number;
  myanimelist_id?: number | null;
  rates_scores_stats?: Array<{ name?: number; value?: number }>;
  rates_statuses_stats?: Array<{ name?: string; value?: number }>;
  genres?: ShikimoriGenreResponse[];
  studios?: Array<{ id?: number; name?: string; filtered_name?: string; real?: boolean }>;
  videos?: unknown[];
  screenshots?: ShikimoriImageResponse[];
  user_rate?: unknown;
}

interface ShikimoriImageResponse {
  original?: string;
  preview?: string;
  x96?: string;
  x48?: string;
}

interface ShikimoriGenreResponse {
  id?: number;
  name?: string;
  russian?: string;
  kind?: string;
}

interface ShikimoriRoleResponse {
  roles?: string[];
  roles_russian?: string[];
  character?: ShikimoriPersonResponse | null;
  person?: ShikimoriPersonResponse | null;
}

interface ShikimoriPersonResponse {
  id?: number;
  name?: string;
  russian?: string;
  image?: ShikimoriImageResponse;
  url?: string;
}

// Builds a defensive provider configuration from public options.
// Собирает защищенную конфигурацию провайдера из публичных опций.
function createShikimoriConfig(options: ShikimoriProviderOptions): ShikimoriConfig {
  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch,
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    personLimit: options.personLimit ?? DEFAULT_PERSON_LIMIT,
    userAgent: options.userAgent,
    censored: options.censored ?? false,
  };
}

// Runs Shikimori search by title or supported external IDs.
// Выполняет поиск Shikimori по названию или поддерживаемым внешним ID.
async function searchShikimori(
  config: ShikimoriConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type && query.type !== "anime") {
    return [];
  }

  if (query.ids?.shikimori) {
    const details = await getAnimeById(config, query.ids.shikimori, context);
    return details ? [detailsToSearchResult(config, details, context.debug)] : [];
  }

  if (!query.title) {
    return [];
  }

  const response = await requestShikimori<ShikimoriAnimeSearchResult[]>(
    config,
    "/api/animes",
    {
      search: query.title,
      limit: String(query.limit ?? config.searchLimit),
      order: "popularity",
      kind: "tv,movie,ova,ona,special,music",
      censored: String(config.censored),
    },
    context,
  );

  return response.map((item) =>
    createSearchResult(config, mapAnimeSearchResult(config, item), context.debug),
  );
}

// Resolves detailed Shikimori anime metadata by Shikimori ID.
// Получает подробные metadata Shikimori anime по Shikimori ID.
async function getShikimoriDetails(
  config: ShikimoriConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (query.type && query.type !== "anime") {
    return null;
  }

  const details = query.ids?.shikimori
    ? await getAnimeById(config, query.ids.shikimori, context)
    : null;

  if (!details) {
    return null;
  }

  return {
    provider: PROVIDER_NAME,
    details,
    source: createProviderSource(config, details.ids),
    raw: context.debug ? details : undefined,
  };
}

// Fetches and maps Shikimori anime details.
// Загружает и преобразует детали anime Shikimori.
async function getAnimeById(
  config: ShikimoriConfig,
  shikimoriId: string,
  context: ProviderContext,
): Promise<AnimeDetails> {
  const encodedId = encodeURIComponent(shikimoriId);
  const [data, roles, screenshots] = await Promise.all([
    requestShikimori<ShikimoriAnimeDetailsResponse>(
      config,
      `/api/animes/${encodedId}`,
      {},
      context,
    ),
    requestShikimori<ShikimoriRoleResponse[]>(
      config,
      `/api/animes/${encodedId}/roles`,
      {},
      context,
    ),
    requestShikimori<ShikimoriImageResponse[]>(
      config,
      `/api/animes/${encodedId}/screenshots`,
      {},
      context,
    ),
  ]);

  return mapAnimeDetails(config, data, roles, screenshots);
}

// Performs one Shikimori JSON request.
// Выполняет один JSON-запрос к Shikimori.
async function requestShikimori<T>(
  config: ShikimoriConfig,
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
      headers: createHeaders(config),
    },
  });
}

// Maps a Shikimori search item into Media Engine search item.
// Преобразует результат поиска Shikimori в search item Media Engine.
function mapAnimeSearchResult(
  config: ShikimoriConfig,
  item: ShikimoriAnimeSearchResult,
  extraIds: ExternalIds = {},
): MediaItem {
  return {
    id: createMediaId(item.id),
    type: "anime",
    title: item.russian || item.name || `Shikimori anime ${item.id}`,
    originalTitle: item.name,
    alternativeTitles: collectUnique([item.russian, item.name]).filter(
      (title) => title !== item.russian && title !== item.name,
    ),
    year: getYear(item.aired_on),
    releaseDate: item.aired_on || undefined,
    description: undefined,
    poster: createImage(config, item.image, "poster"),
    ratings: createRatings(item.score),
    ids: {
      ...extraIds,
      shikimori: String(item.id),
    },
  };
}

// Maps a Shikimori anime details response into Media Engine details.
// Преобразует ответ деталей Shikimori anime в details Media Engine.
function mapAnimeDetails(
  config: ShikimoriConfig,
  item: ShikimoriAnimeDetailsResponse,
  roles: ShikimoriRoleResponse[],
  screenshots: ShikimoriImageResponse[],
): AnimeDetails {
  const ids = createIds(item.id, item.myanimelist_id);
  const details: AnimeDetails = {
    ...mapAnimeSearchResult(config, item, ids),
    type: "anime",
    alternativeTitles: mapAlternativeTitles(item),
    description: item.description || undefined,
    shortDescription: item.description_source || undefined,
    genres: mapGenres(item.genres),
    ratings: createRatings(item.score, item.rates_scores_stats),
    status: mapStatus(item.status),
    runtimeMinutes: item.duration,
    countries: ["JP"],
    languages: ["ja"],
    images: mapImages(config, item, screenshots),
    persons: mapPersons(config, roles, config.personLimit),
    sourceProviders: [createProviderSource(config, ids)],
    animeKind: mapAnimeKind(item.kind),
    episodes: createEpisodes(item.episodes),
    episodesCount: item.episodes || undefined,
    airedOn: item.aired_on || undefined,
    releasedOn: item.released_on || undefined,
    ageRating: item.rating,
  };

  return details;
}

// Converts details back to provider search result for ID searches.
// Преобразует details обратно в provider search result для поиска по ID.
function detailsToSearchResult(
  config: ShikimoriConfig,
  details: AnimeDetails,
  debug: boolean | undefined,
): ProviderSearchResult {
  return createSearchResult(
    config,
    {
      id: details.id,
      type: "anime",
      title: details.title,
      originalTitle: details.originalTitle,
      alternativeTitles: details.alternativeTitles,
      year: details.year,
      releaseDate: details.releaseDate,
      description: details.description,
      poster: details.poster,
      genres: details.genres,
      ratings: details.ratings,
      ids: details.ids,
    },
    debug,
  );
}

// Wraps a media item into a provider search result.
// Заворачивает media item в provider search result.
function createSearchResult(
  config: ShikimoriConfig,
  item: MediaItem,
  debug: boolean | undefined,
): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    confidence: item.ids?.shikimori || item.ids?.myAnimeList ? 1 : 0.8,
    source: createProviderSource(config, item.ids),
    raw: debug ? item : undefined,
  };
}

// Builds normalized external IDs for Shikimori anime.
// Собирает нормализованные external IDs для Shikimori anime.
function createIds(shikimoriId: number, myAnimeListId: number | null | undefined): ExternalIds {
  return {
    shikimori: String(shikimoriId),
    myAnimeList: myAnimeListId ? String(myAnimeListId) : undefined,
  };
}

// Builds normalized provider attribution.
// Собирает нормализованную атрибуцию провайдера.
function createProviderSource(
  config: ShikimoriConfig,
  ids: ExternalIds | undefined,
): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: ids?.shikimori ? `${config.baseUrl}/animes/${ids.shikimori}` : undefined,
  };
}

// Creates an image from Shikimori relative image paths.
// Создает изображение из относительных путей Shikimori.
function createImage(
  config: ShikimoriConfig,
  image: ShikimoriImageResponse | undefined,
  type: Image["type"],
): Image | undefined {
  const path = image?.original ?? image?.preview ?? image?.x96 ?? image?.x48;

  if (!path) {
    return undefined;
  }

  return {
    url: createAbsoluteUrl(config, path),
    type,
    source: PROVIDER_NAME,
  };
}

// Maps all Shikimori detail images into normalized image metadata.
// Преобразует все detail images Shikimori в нормализованные metadata изображений.
function mapImages(
  config: ShikimoriConfig,
  item: ShikimoriAnimeDetailsResponse,
  screenshots: ShikimoriImageResponse[],
): Image[] | undefined {
  const images = [
    createImage(config, item.image, "poster"),
    ...(screenshots.length ? screenshots : (item.screenshots ?? [])).map((image) =>
      createImage(config, image, "still"),
    ),
  ].filter(isDefined);

  return images.length ? images : undefined;
}

// Maps Shikimori genres into normalized genre labels.
// Преобразует жанры Shikimori в нормализованные названия жанров.
function mapGenres(genres: ShikimoriGenreResponse[] | undefined): AnimeDetails["genres"] {
  const mapped = (genres ?? []).flatMap((genre) => {
    const name = genre.russian || genre.name;

    if (!name) {
      return [];
    }

    return [
      {
        id: genre.id ? String(genre.id) : undefined,
        name,
        source: PROVIDER_NAME,
      },
    ];
  });

  return mapped.length ? mapped : undefined;
}

// Maps Shikimori score stats into normalized ratings.
// Преобразует score stats Shikimori в нормализованные рейтинги.
function createRatings(
  score: string | undefined,
  stats: Array<{ name?: number; value?: number }> = [],
): Rating[] | undefined {
  const value = score ? Number.parseFloat(score) : Number.NaN;
  const votes = stats.reduce((total, item) => total + (item.value ?? 0), 0);

  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return [
    {
      source: "shikimori",
      value,
      max: 10,
      votes: votes || undefined,
    },
  ];
}

// Maps Shikimori status into Media Engine lifecycle status.
// Преобразует status Shikimori в lifecycle status Media Engine.
function mapStatus(status: string | undefined): MediaStatus | undefined {
  switch (status) {
    case "anons":
      return "announced";
    case "ongoing":
      return "ongoing";
    case "released":
      return "ended";
    default:
      return status ? "unknown" : undefined;
  }
}

// Maps Shikimori kind into anime release format.
// Преобразует kind Shikimori в формат релиза аниме.
function mapAnimeKind(kind: string | undefined): AnimeKind | undefined {
  switch (kind) {
    case "tv":
    case "movie":
    case "ova":
    case "ona":
    case "special":
    case "music":
      return kind;
    default:
      return kind ? "unknown" : undefined;
  }
}

// Creates placeholder episode entries when Shikimori only returns a count.
// Создает placeholder episodes, когда Shikimori возвращает только количество.
function createEpisodes(count: number | undefined): AnimeDetails["episodes"] {
  if (!count || count <= 0) {
    return undefined;
  }

  return Array.from({ length: count }, (_, index) => ({
    episodeNumber: index + 1,
    absoluteNumber: index + 1,
  }));
}

// Maps character and staff roles into normalized media persons.
// Преобразует роли characters и staff в нормализованные media persons.
function mapPersons(
  config: ShikimoriConfig,
  roles: ShikimoriRoleResponse[],
  limit: number,
): MediaPerson[] | undefined {
  const characterPersons = roles
    .map((role, index) => mapCharacterRole(config, role, index))
    .filter(isDefined);
  const staffPersons = roles
    .map((role, index) => mapStaffRole(config, role, characterPersons.length + index))
    .filter(isDefined);
  const persons = [...characterPersons, ...staffPersons].slice(0, limit);

  return persons.length ? persons : undefined;
}

// Maps a Shikimori character role into a voice actor person.
// Преобразует character role Shikimori в voice actor person.
function mapCharacterRole(
  config: ShikimoriConfig,
  role: ShikimoriRoleResponse,
  order: number,
): MediaPerson | undefined {
  const person = role.character;

  if (!person?.name && !person?.russian) {
    return undefined;
  }

  return {
    person: mapPerson(config, person),
    roles: ["voice_actor"],
    characterName: person.russian || person.name,
    order,
  };
}

// Maps a Shikimori staff role into a normalized media person.
// Преобразует staff role Shikimori в нормализованную media person.
function mapStaffRole(
  config: ShikimoriConfig,
  role: ShikimoriRoleResponse,
  order: number,
): MediaPerson | undefined {
  const person = role.person;

  if (!person?.name && !person?.russian) {
    return undefined;
  }

  return {
    person: mapPerson(config, person),
    roles: mapPersonRoles(role.roles),
    order,
  };
}

// Maps Shikimori person payload into normalized person metadata.
// Преобразует person payload Shikimori в нормализованные person metadata.
function mapPerson(
  config: ShikimoriConfig,
  person: ShikimoriPersonResponse,
): MediaPerson["person"] {
  return {
    id: person.id ? createPersonId(person.id) : undefined,
    name: person.russian || person.name || "Unknown",
    originalName: person.name,
    photo: createImage(config, person.image, "profile"),
    ids: {
      shikimori: person.id ? String(person.id) : undefined,
    },
  };
}

// Maps Shikimori staff role labels into Media Engine roles.
// Преобразует staff role labels Shikimori в роли Media Engine.
function mapPersonRoles(roles: string[] | undefined): MediaPerson["roles"] {
  const mapped = (roles ?? []).map((role) => {
    switch (role.toLowerCase()) {
      case "director":
        return "director";
      case "producer":
        return "producer";
      case "mangaka":
      case "original creator":
      case "screenwriter":
        return "writer";
      case "music":
        return "composer";
      default:
        return "unknown";
    }
  });

  return mapped.length ? collectUnique(mapped) : ["unknown"];
}

// Collects normalized alternative titles from Shikimori details.
// Собирает нормализованные alternative titles из деталей Shikimori.
function mapAlternativeTitles(item: ShikimoriAnimeDetailsResponse): string[] | undefined {
  const titles = collectUnique([
    item.name,
    item.russian,
    ...(item.english ?? []),
    ...(item.japanese ?? []),
    ...(item.synonyms ?? []),
    item.license_name_ru ?? undefined,
  ]).filter((title) => title !== item.russian);

  return titles.length ? titles : undefined;
}

// Creates request headers expected by Shikimori API.
// Создает headers, ожидаемые Shikimori API.
function createHeaders(config: ShikimoriConfig): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (config.userAgent) {
    headers["user-agent"] = config.userAgent;
  }

  return headers;
}

// Converts a relative or absolute Shikimori URL into absolute URL.
// Преобразует относительный или абсолютный Shikimori URL в absolute URL.
function createAbsoluteUrl(config: ShikimoriConfig, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${config.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Creates stable provider-scoped media ID.
// Создает стабильный media ID в области провайдера.
function createMediaId(id: number): string {
  return `${PROVIDER_NAME}:anime:${id}`;
}

// Creates stable provider-scoped person ID.
// Создает стабильный person ID в области провайдера.
function createPersonId(id: number): string {
  return `${PROVIDER_NAME}:person:${id}`;
}

// Extracts year from an ISO-like date string.
// Извлекает год из ISO-like строки даты.
function getYear(date: string | null | undefined): number | undefined {
  if (!date) {
    return undefined;
  }

  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

// Removes a trailing slash from base URLs.
// Удаляет завершающий slash из base URL.
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// Checks whether a value is present after filtering arrays.
// Проверяет, что значение присутствует после фильтрации массивов.
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// Collects unique truthy string values while preserving order.
// Собирает уникальные truthy строки с сохранением порядка.
function collectUnique<T extends string>(values: Array<T | undefined | null>): T[] {
  return Array.from(new Set(values.filter((value): value is T => Boolean(value))));
}
