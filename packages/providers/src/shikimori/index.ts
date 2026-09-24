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
  ProviderMediaRelation,
  ProviderRelatedMediaQuery,
  ProviderRelatedMediaResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
} from "@media-engine/core";
import { type MediaProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  fetchJson,
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import { createProviderImage } from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { matchesSearchFilters, normalizeFilterValue } from "../shared/search-filters.js";

const PROVIDER_NAME = "shikimori";
const DEFAULT_BASE_URL = "https://shikimori.one";
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PERSON_LIMIT = 20;
const MAX_SEARCH_RESULTS = 250;
const SEARCH_PAGE_SIZE = 50;

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
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["anime"],
      search: {
        byTitle: true,
        byExternalIds: ["shikimori", "myAnimeList"],
        filterDiscovery: ["year", "genre", "minimumRating"],
      },
      details: {
        byExternalIds: ["shikimori", "myAnimeList"],
      },
      relatedMedia: {
        byExternalIds: ["shikimori"],
      },
      features: [
        "posters",
        "backdrops",
        "ratings",
        "genres",
        "persons",
        "episodes",
        "alternative_titles",
        "relations",
      ],
    },
    async search(query, context) {
      return searchShikimori(config, query, context);
    },
    async getDetails(query, context) {
      return getShikimoriDetails(config, query, context);
    },
    async getRelatedMedia(query, context) {
      return getShikimoriRelatedMedia(config, query, context);
    },
  };
}

// Internal normalized Shikimori provider configuration.
// Внутренняя нормализованная конфигурация Shikimori-провайдера.
interface ShikimoriConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
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
  entry_type?: string;
}

interface ShikimoriRoleResponse {
  roles?: string[];
  roles_russian?: string[];
  character?: ShikimoriPersonResponse | null;
  person?: ShikimoriPersonResponse | null;
}

interface ShikimoriRelatedResponse {
  relation?: string;
  relation_russian?: string;
  anime?: ShikimoriAnimeSearchResult | null;
  manga?: unknown;
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
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "Shikimori searchLimit",
      1,
      50,
    ),
    personLimit: resolveBoundedIntegerOption(
      options.personLimit,
      DEFAULT_PERSON_LIMIT,
      "Shikimori personLimit",
      0,
      100,
    ),
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

  if (query.ids?.shikimori || query.ids?.myAnimeList) {
    const details = await getAnimeById(
      config,
      query.ids.shikimori ?? query.ids.myAnimeList!,
      context,
    );
    if (query.ids.myAnimeList && details.ids?.myAnimeList !== query.ids.myAnimeList) return [];
    return details ? [detailsToSearchResult(config, details, context.debug)] : [];
  }

  if (
    !query.title &&
    query.year === undefined &&
    !query.genre &&
    query.minimumRating === undefined
  ) {
    return [];
  }

  const genre = query.genre ? await findShikimoriGenre(config, query.genre, context) : undefined;

  if (query.genre && !genre) {
    return [];
  }

  const targetLimit = Math.min(query.limit ?? config.searchLimit, MAX_SEARCH_RESULTS);

  if (targetLimit <= 0) return [];

  const pageSize = Math.min(targetLimit, SEARCH_PAGE_SIZE);
  const itemsById = new Map<string, MediaItem>();

  for (let page = 1; page <= Math.ceil(targetLimit / pageSize); page += 1) {
    const response = await requestShikimori<ShikimoriAnimeSearchResult[]>(
      config,
      "/api/animes",
      {
        search: query.title,
        season: query.year === undefined ? undefined : String(query.year),
        genre: genre?.id === undefined ? undefined : String(genre.id),
        score: query.minimumRating === undefined ? undefined : String(query.minimumRating),
        page: String(page),
        limit: String(pageSize),
        order: "popularity",
        kind: "tv,movie,ova,ona,special,music",
        censored: String(config.censored),
      },
      context,
    );

    for (const result of response) {
      const item = mapAnimeSearchResult(
        config,
        result,
        {},
        query.genre && genre
          ? [
              {
                id: genre.id ? String(genre.id) : undefined,
                name: query.genre,
                source: PROVIDER_NAME,
              },
            ]
          : undefined,
      );

      if (matchesSearchFilters(item, query)) {
        itemsById.set(item.id, item);
      }
    }

    if (itemsById.size >= targetLimit || response.length < pageSize) break;
  }

  const items = [...itemsById.values()].slice(0, targetLimit);
  if ((context.language ?? query.language)?.toLowerCase().startsWith("ru")) {
    await enrichRussianSearchItems(config, items, context);
  }
  return items.map((item) => createSearchResult(config, item, context.debug));
}

// Fetches localized descriptions and genres in bounded groups, without one request per anime.
async function enrichRussianSearchItems(
  config: ShikimoriConfig,
  items: MediaItem[],
  context: ProviderContext,
): Promise<void> {
  const query = `query ($ids: String!) { animes(ids: $ids, limit: 50) { id description genres { id name russian } } }`;
  for (let offset = 0; offset < items.length; offset += 50) {
    const batch = items.slice(offset, offset + 50);
    const ids = batch
      .map((item) => item.ids?.shikimori)
      .filter(Boolean)
      .join(",");
    if (!ids) continue;
    try {
      const response = await fetchJson<{
        data?: {
          animes?: Array<{ id: string; description?: string; genres?: ShikimoriGenreResponse[] }>;
        };
      }>({
        provider: PROVIDER_NAME,
        url: new URL(`${config.baseUrl}/api/graphql`),
        context,
        fetch: config.fetch,
        rateLimitGate: config.rateLimitGate,
        init: {
          method: "POST",
          headers: { ...createHeaders(config), "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { ids } }),
        },
      });
      const enriched = new Map(response.data?.animes?.map((anime) => [anime.id, anime]));
      for (const item of batch) {
        const anime = enriched.get(item.ids?.shikimori ?? "");
        if (!anime) continue;
        item.description = normalizeDescription(anime.description);
        item.genres = mapGenres(anime.genres) ?? item.genres;
      }
    } catch (error) {
      rethrowIfProviderAborted(context, error);
    }
  }
}

async function findShikimoriGenre(
  config: ShikimoriConfig,
  requestedGenre: string,
  context: ProviderContext,
): Promise<ShikimoriGenreResponse | undefined> {
  const genres = await requestShikimori<ShikimoriGenreResponse[]>(
    config,
    "/api/genres",
    {},
    context,
  );
  const normalizedGenre = normalizeFilterValue(requestedGenre);

  return genres.find(
    (genre) =>
      [genre.entry_type, genre.kind].some(
        (value) => value && normalizeFilterValue(value) === "anime",
      ) &&
      [genre.name, genre.russian].some(
        (name) => name && normalizeFilterValue(name) === normalizedGenre,
      ),
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

  const details =
    query.ids?.shikimori || query.ids?.myAnimeList
      ? await getAnimeById(config, query.ids.shikimori ?? query.ids.myAnimeList!, context)
      : null;

  if (!details || (query.ids?.myAnimeList && details.ids?.myAnimeList !== query.ids.myAnimeList)) {
    return null;
  }

  return {
    provider: PROVIDER_NAME,
    details,
    source: createProviderSource(config, details.ids),
    raw: context.debug ? details : undefined,
  };
}

// Loads and normalizes direct anime relationships from Shikimori.
// Загружает и нормализует прямые связи аниме из Shikimori.
async function getShikimoriRelatedMedia(
  config: ShikimoriConfig,
  query: ProviderRelatedMediaQuery,
  context: ProviderContext,
): Promise<ProviderRelatedMediaResult | null> {
  if (query.type && query.type !== "anime") return null;

  const shikimoriId = query.ids?.shikimori;
  if (!shikimoriId) return null;

  const response = await requestShikimori<ShikimoriRelatedResponse[]>(
    config,
    `/api/animes/${encodeURIComponent(shikimoriId)}/related`,
    {},
    context,
  );
  const relations = response
    .slice(0, query.limit ?? 100)
    .map((entry) => mapRelatedAnime(config, entry))
    .filter(isDefined);

  return {
    provider: PROVIDER_NAME,
    relations,
    raw: context.debug ? response : undefined,
  };
}

function mapRelatedAnime(
  config: ShikimoriConfig,
  entry: ShikimoriRelatedResponse,
): ProviderMediaRelation | undefined {
  const anime = entry.anime;
  if (!anime || !Number.isInteger(anime.id) || anime.id <= 0) return undefined;

  const kind = mapRelationKind(entry.relation);
  const item = mapAnimeSearchResult(config, anime);

  return {
    kind,
    item: {
      ...item,
      status: mapStatus(anime.status),
      animeKind: mapAnimeKind(anime.kind),
      episodesCount: anime.episodes && anime.episodes > 0 ? anime.episodes : undefined,
    },
    source: createProviderSource(config, item.ids),
  };
}

function mapRelationKind(relation: string | undefined): ProviderMediaRelation["kind"] {
  const normalized = relation
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");

  switch (normalized) {
    case "adaptation":
    case "alternative_setting":
    case "alternative_version":
    case "character":
    case "full_story":
    case "parent_story":
    case "prequel":
    case "sequel":
    case "side_story":
    case "spin_off":
    case "summary":
      return normalized;
    default:
      return "other";
  }
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
    ).catch((error: unknown) => {
      rethrowIfProviderAborted(context, error);
      return [];
    }),
    requestShikimori<ShikimoriImageResponse[]>(
      config,
      `/api/animes/${encodedId}/screenshots`,
      {},
      context,
    ).catch((error: unknown) => {
      rethrowIfProviderAborted(context, error);
      return [];
    }),
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
    rateLimitGate: config.rateLimitGate,
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
  genres?: MediaItem["genres"],
): MediaItem {
  const title = item.russian || item.name || `Shikimori anime ${item.id}`;
  const alternativeTitles = collectUnique([item.russian, item.name]).filter(
    (candidate) => candidate !== title,
  );

  return {
    id: createMediaId(item.id),
    type: "anime",
    title,
    originalTitle: item.name,
    alternativeTitles: alternativeTitles.length > 0 ? alternativeTitles : undefined,
    year: getYear(item.aired_on),
    releaseDate: item.aired_on || undefined,
    description: undefined,
    poster: createImage(config, item.image, "poster"),
    genres,
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
  const images = mapImages(config, item, screenshots);
  const details: AnimeDetails = {
    ...mapAnimeSearchResult(config, item, ids),
    type: "anime",
    alternativeTitles: mapAlternativeTitles(item),
    description: normalizeDescription(item.description),
    shortDescription: item.description_source || undefined,
    genres: mapGenres(item.genres),
    ratings: createRatings(item.score, item.rates_scores_stats),
    status: mapStatus(item.status),
    runtimeMinutes: item.duration,
    countries: ["JP"],
    languages: ["ja"],
    backdrop: images?.find((image) => image.type === "backdrop"),
    images,
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

// Removes Shikimori BBCode references that should not leak into public text.
// Убирает BBCode-ссылки Shikimori, которые не должны попадать в публичный текст.
function normalizeDescription(description: string | null | undefined): string | undefined {
  const normalized = description
    ?.replace(/\[(?:character|person|anime|manga)=[^\]]+\]/gi, "")
    .replace(/\[\/(?:character|person|anime|manga)\]/gi, "")
    .trim();

  return normalized || undefined;
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
      backdrop: details.backdrop,
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
    url: normalizeProviderOutputUrl(
      ids?.shikimori ? `${config.baseUrl}/animes/${ids.shikimori}` : undefined,
    ),
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

  return createProviderImage(createAbsoluteUrl(config, path), type, PROVIDER_NAME);
}

// Maps all Shikimori detail images into normalized image metadata.
// Преобразует все detail images Shikimori в нормализованные metadata изображений.
function mapImages(
  config: ShikimoriConfig,
  item: ShikimoriAnimeDetailsResponse,
  screenshots: ShikimoriImageResponse[],
): Image[] | undefined {
  const availableScreenshots = screenshots.length ? screenshots : (item.screenshots ?? []);
  const [backdrop, ...stills] = availableScreenshots
    .map((image) => createImage(config, image, "still"))
    .filter(isDefined);
  const images = [
    createImage(config, item.image, "poster"),
    backdrop ? { ...backdrop, type: "backdrop" as const } : undefined,
    ...stills,
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
      return undefined;
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
