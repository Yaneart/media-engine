import type {
  ExternalIds,
  Image,
  MediaDetails,
  MediaItem,
  MediaType,
  MovieDetails,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  SeriesDetails,
} from "@media-engine/core";
import { type MediaProvider } from "@media-engine/core";
import {
  fetchJson,
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import {
  createProviderImage,
  normalizeProviderSearchText as normalizeSearchText,
} from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";

const PROVIDER_NAME = "wikidata";
const DEFAULT_BASE_URL = "https://www.wikidata.org";
const DEFAULT_SPARQL_URL = "https://query.wikidata.org/sparql";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_USER_AGENT = "MediaEngine/0.0.0 (https://github.com/Yaneart/media-engine)";

const MOVIE_INSTANCE_IDS = new Set(["Q11424", "Q506240"]);
const SERIES_INSTANCE_IDS = new Set(["Q5398426", "Q1259759", "Q15416"]);

// Options used to create a no-token Wikidata metadata provider.
// Опции для создания metadata-провайдера Wikidata без токена.
export interface WikidataProviderOptions {
  baseUrl?: string;
  sparqlUrl?: string;
  language?: string;
  userAgent?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
}

// Creates a Wikidata metadata provider for basic movie and series lookup.
// Создает metadata-провайдер Wikidata для базового поиска фильмов и сериалов.
export function wikidataProvider(options: WikidataProviderOptions = {}): MediaProvider {
  const config = createWikidataConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["movie", "series"],
      searchEnrichment: false,
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
        titleDiscovery: "fallback",
      },
      details: {
        byExternalIds: ["imdb"],
      },
      features: ["posters"],
    },
    async search(query, context) {
      return searchWikidata(config, query, context);
    },
    async getDetails(query, context) {
      return getWikidataDetails(config, query, context);
    },
  };
}

// Internal normalized Wikidata provider configuration.
// Внутренняя нормализованная конфигурация Wikidata-провайдера.
interface WikidataConfig {
  baseUrl: string;
  sparqlUrl: string;
  language: string;
  userAgent: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
}

interface WikidataSearchResponse {
  search?: Array<{ id?: string }>;
}

interface WikidataEntityResponse {
  entities?: Record<string, WikidataEntity>;
}

interface WikidataEntity {
  id: string;
  labels?: Record<string, WikidataTextValue>;
  descriptions?: Record<string, WikidataTextValue>;
  claims?: Record<string, WikidataClaim[]>;
}

interface WikidataTextValue {
  value?: string;
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: {
      value?: WikidataClaimValue;
    };
  };
}

type WikidataClaimValue =
  | string
  | {
      id?: string;
      time?: string;
      amount?: string;
      text?: string;
    };

interface WikidataSparqlResponse {
  results?: {
    bindings?: Array<{
      item?: {
        value?: string;
      };
    }>;
  };
}

// Builds provider config with conservative defaults for public Wikimedia APIs.
// Собирает конфигурацию с консервативными defaults для публичных Wikimedia API.
function createWikidataConfig(options: WikidataProviderOptions): WikidataConfig {
  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    sparqlUrl: options.sparqlUrl ?? DEFAULT_SPARQL_URL,
    language: normalizeLanguage(options.language ?? DEFAULT_LANGUAGE),
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    fetch: options.fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "Wikidata searchLimit",
      1,
      50,
    ),
  };
}

// Runs title or IMDb ID search through Wikidata without requiring credentials.
// Выполняет поиск по названию или IMDb ID через Wikidata без credentials.
async function searchWikidata(
  config: WikidataConfig,
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

  const entityIds = await searchEntityIds(config, query, context);
  const entities = await getEntities(config, entityIds, context);

  return entities
    .map((entity) => mapEntityToItem(config, entity, query, context))
    .filter((item): item is MediaItem => item !== undefined)
    .map((item) => createSearchResult(item, context.debug));
}

// Loads details by IMDb ID when the selected search result exposes one.
// Загружает детали по IMDb ID, если выбранный результат поиска его содержит.
async function getWikidataDetails(
  config: WikidataConfig,
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
        source: createProviderSource(details.ids),
        raw: context.debug ? details : undefined,
        confidence: 0.9,
      }
    : null;
}

// Resolves one Wikidata entity through an exact IMDb ID SPARQL lookup.
// Находит одну Wikidata entity через точный SPARQL lookup по IMDb ID.
async function getDetailsByImdbId(
  config: WikidataConfig,
  imdbId: string,
  type: MediaType | undefined,
  context: ProviderContext,
): Promise<MediaDetails | null> {
  const entityId = await findEntityIdByImdbId(config, imdbId, context);

  if (!entityId) {
    return null;
  }

  const [entity] = await getEntities(config, [entityId], context);
  const item = entity
    ? mapEntityToItem(config, entity, { ids: { imdb: imdbId }, type }, context)
    : undefined;

  return item ? itemToDetails(item) : null;
}

// Searches Wikidata item IDs using the public Action API search endpoint.
// Ищет Wikidata item IDs через публичный search endpoint Action API.
async function searchEntityIds(
  config: WikidataConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<string[]> {
  const url = new URL(`${config.baseUrl}/w/api.php`);
  const language = normalizeLanguage(query.language ?? context.language ?? config.language);

  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("type", "item");
  url.searchParams.set("language", language);
  url.searchParams.set("uselang", language);
  url.searchParams.set("search", query.title ?? "");
  url.searchParams.set("limit", String(config.searchLimit));

  const response = await requestJson<WikidataSearchResponse>(config, url, context);

  return (response.search ?? [])
    .map((result) => result.id)
    .filter((id): id is string => Boolean(id));
}

// Loads full Wikidata entity JSON for candidate IDs.
// Загружает полный JSON Wikidata entity для candidate IDs.
async function getEntities(
  config: WikidataConfig,
  entityIds: string[],
  context: ProviderContext,
): Promise<WikidataEntity[]> {
  if (!entityIds.length) {
    return [];
  }

  const url = new URL(`${config.baseUrl}/w/api.php`);

  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("ids", entityIds.join("|"));
  url.searchParams.set("props", "labels|descriptions|claims");

  const response = await requestJson<WikidataEntityResponse>(config, url, context);

  return Object.values(response.entities ?? {}).filter(isKnownEntity);
}

// Finds one Wikidata item ID by exact IMDb title ID.
// Находит один Wikidata item ID по точному IMDb title ID.
async function findEntityIdByImdbId(
  config: WikidataConfig,
  imdbId: string,
  context: ProviderContext,
): Promise<string | undefined> {
  const url = new URL(config.sparqlUrl);
  const query = `SELECT ?item WHERE { ?item wdt:P345 "${escapeSparqlString(imdbId)}". } LIMIT 1`;

  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  const response = await requestJson<WikidataSparqlResponse>(config, url, context);
  const itemUrl = response.results?.bindings?.[0]?.item?.value;

  return itemUrl?.split("/").at(-1);
}

// Maps a Wikidata entity into the normalized compact media model.
// Преобразует Wikidata entity в нормализованную compact media model.
function mapEntityToItem(
  config: WikidataConfig,
  entity: WikidataEntity,
  query: Pick<ProviderSearchQuery, "title" | "type" | "year" | "ids">,
  context: ProviderContext,
): MediaItem | undefined {
  const type = getMediaType(entity);

  if (!type || (query.type && query.type !== type)) {
    return undefined;
  }

  const title = getLabel(entity, context.language ?? config.language);

  if (!title || (query.title && !isRelevantTitleMatch(title, query.title))) {
    return undefined;
  }

  const releaseDate = getTimeClaim(entity, "P577");
  const year = getYear(releaseDate);

  if (query.year !== undefined && year !== undefined && query.year !== year) {
    return undefined;
  }

  const ids = createIds(entity, query.ids);

  return {
    id: `${PROVIDER_NAME}-${type}-${entity.id}`,
    type,
    title,
    originalTitle: getMonolingualTextClaim(entity, "P1476"),
    year,
    releaseDate,
    description: getDescription(entity, context.language ?? config.language),
    poster: getImage(entity),
    ids,
  };
}

// Converts compact Wikidata item data into basic details.
// Преобразует compact данные Wikidata item в базовые details.
function itemToDetails(item: MediaItem): MediaDetails {
  const sourceProviders = [createProviderSource(item.ids)];

  if (item.type === "series") {
    const details: SeriesDetails = {
      ...item,
      type: "series",
      sourceProviders,
    };

    return details;
  }

  const details: MovieDetails = {
    ...item,
    type: "movie",
    sourceProviders,
  };

  return details;
}

// Creates a provider search result wrapper with source attribution.
// Создает search result wrapper с атрибуцией источника.
function createSearchResult(item: MediaItem, debug: boolean | undefined): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    source: createProviderSource(item.ids),
    raw: debug ? item : undefined,
    confidence: item.ids?.imdb ? 0.8 : 0.65,
  };
}

// Converts details back to a search result for IMDb ID searches.
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
      originalTitle: details.originalTitle,
      year: details.year,
      releaseDate: details.releaseDate,
      description: details.description,
      poster: details.poster,
      ids: details.ids,
    },
    debug,
  );
}

// Creates source attribution for Wikidata results.
// Создает атрибуцию источника для результатов Wikidata.
function createProviderSource(ids: ExternalIds | undefined): ProviderSource {
  const imdbId = ids?.imdb;

  return {
    provider: PROVIDER_NAME,
    ids,
    url: normalizeProviderOutputUrl(imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined),
  };
}

// Creates normalized external IDs from Wikidata claims.
// Создает нормализованные external IDs из Wikidata claims.
function createIds(entity: WikidataEntity, extraIds: ExternalIds | undefined): ExternalIds {
  return {
    ...extraIds,
    imdb: extraIds?.imdb ?? getStringClaim(entity, "P345"),
  };
}

// Determines whether a Wikidata entity is a movie or a series.
// Определяет, является ли Wikidata entity фильмом или сериалом.
function getMediaType(entity: WikidataEntity): MediaType | undefined {
  const instanceIds = getItemClaimIds(entity, "P31");

  if (instanceIds.some((id) => MOVIE_INSTANCE_IDS.has(id))) {
    return "movie";
  }

  if (instanceIds.some((id) => SERIES_INSTANCE_IDS.has(id))) {
    return "series";
  }

  return undefined;
}

// Reads localized entity label with English fallback.
// Читает локализованный label entity с fallback на English.
function getLabel(entity: WikidataEntity, language: string): string | undefined {
  return entity.labels?.[normalizeLanguage(language)]?.value ?? entity.labels?.en?.value;
}

// Reads localized entity description with English fallback.
// Читает локализованное description entity с fallback на English.
function getDescription(entity: WikidataEntity, language: string): string | undefined {
  return (
    entity.descriptions?.[normalizeLanguage(language)]?.value ?? entity.descriptions?.en?.value
  );
}

// Reads one string-valued claim.
// Читает один claim со строковым значением.
function getStringClaim(entity: WikidataEntity, property: string): string | undefined {
  return getClaimValues(entity, property).find(
    (value): value is string => typeof value === "string",
  );
}

// Reads one monolingual text claim.
// Читает один monolingual text claim.
function getMonolingualTextClaim(entity: WikidataEntity, property: string): string | undefined {
  return getClaimValues(entity, property)
    .map((value) => (typeof value === "object" ? value.text : undefined))
    .find((value): value is string => Boolean(value));
}

// Reads one Wikidata time claim and converts it to an ISO-like date.
// Читает один Wikidata time claim и преобразует его в ISO-like date.
function getTimeClaim(entity: WikidataEntity, property: string): string | undefined {
  const time = getClaimValues(entity, property)
    .map((value) => (typeof value === "object" ? value.time : undefined))
    .find((value): value is string => Boolean(value));

  return time?.replace(/^\+/, "").slice(0, 10);
}

// Reads item IDs from entity-valued claims.
// Читает item IDs из entity-valued claims.
function getItemClaimIds(entity: WikidataEntity, property: string): string[] {
  return getClaimValues(entity, property)
    .map((value) => (typeof value === "object" ? value.id : undefined))
    .filter((value): value is string => Boolean(value));
}

// Reads raw claim values for one property.
// Читает raw claim values для одного свойства.
function getClaimValues(entity: WikidataEntity, property: string): WikidataClaimValue[] {
  return (entity.claims?.[property] ?? [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value): value is WikidataClaimValue => value !== undefined);
}

// Creates a Wikimedia image URL from a Commons filename claim.
// Создает Wikimedia image URL из Commons filename claim.
function getImage(entity: WikidataEntity): Image | undefined {
  const filename = getStringClaim(entity, "P18");
  const url = filename
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        filename.replaceAll(" ", "_"),
      )}`
    : undefined;

  return createProviderImage(url, "poster", PROVIDER_NAME);
}

// Sends provider JSON requests with Wikimedia-friendly headers.
// Отправляет JSON-запросы провайдера с Wikimedia-friendly headers.
function requestJson<T>(config: WikidataConfig, url: URL, context: ProviderContext): Promise<T> {
  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    init: {
      headers: {
        accept: "application/json",
        "user-agent": config.userAgent,
      },
    },
  });
}

// Checks that entity data has a stable ID.
// Проверяет, что entity data содержит стабильный ID.
function isKnownEntity(entity: WikidataEntity): boolean {
  return Boolean(entity.id);
}

// Keeps title matching conservative so generic search noise is dropped.
// Держит matching названия консервативным, чтобы отсечь шум generic search.
function isRelevantTitleMatch(title: string, queryTitle: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(queryTitle);

  return normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle);
}

// Extracts a four-digit year from an ISO-like date.
// Достает четырехзначный год из ISO-like date.
function getYear(date: string | undefined): number | undefined {
  const year = date?.slice(0, 4);

  return year && /^\d{4}$/.test(year) ? Number(year) : undefined;
}

// Normalizes BCP-style language tags to Wikidata language codes.
// Нормализует BCP-style language tags в language codes Wikidata.
function normalizeLanguage(language: string): string {
  return language.split("-")[0]?.trim().toLocaleLowerCase() || DEFAULT_LANGUAGE;
}

// Escapes a literal string for the narrow SPARQL query used here.
// Экранирует literal string для узкого SPARQL-запроса здесь.
function escapeSparqlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
