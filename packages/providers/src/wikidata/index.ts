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
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import { createProviderImage } from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { WikidataCache } from "./cache.js";
import { isRelevantWikidataTitleMatch } from "./candidates.js";
import {
  getWikidataEntityByImdbId,
  normalizeWikidataLanguage,
  searchWikidataEntities,
  type WikidataClaimValue,
  type WikidataClientConfig,
  type WikidataEntity,
} from "./client.js";

const PROVIDER_NAME = "wikidata";
const DEFAULT_BASE_URL = "https://www.wikidata.org";
const DEFAULT_SPARQL_URL = "https://query.wikidata.org/sparql";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_ENTITY_LIMIT = 3;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;

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
  entityLimit?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
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

// Builds provider config with conservative defaults for public Wikimedia APIs.
// Собирает конфигурацию с консервативными defaults для публичных Wikimedia API.
function createWikidataConfig(options: WikidataProviderOptions): WikidataClientConfig {
  const cacheTtlMs = resolveBoundedIntegerOption(
    options.cacheTtlMs,
    DEFAULT_CACHE_TTL_MS,
    "Wikidata cacheTtlMs",
    0,
    7 * 24 * 60 * 60 * 1_000,
  );
  const cacheMaxEntries = resolveBoundedIntegerOption(
    options.cacheMaxEntries,
    DEFAULT_CACHE_MAX_ENTRIES,
    "Wikidata cacheMaxEntries",
    2,
    2_048,
  );

  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    sparqlUrl: options.sparqlUrl ?? DEFAULT_SPARQL_URL,
    language: normalizeWikidataLanguage(options.language ?? DEFAULT_LANGUAGE),
    userAgent: options.userAgent ?? MEDIA_ENGINE_DEFAULT_USER_AGENT,
    fetch: options.fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "Wikidata searchLimit",
      1,
      50,
    ),
    entityLimit: resolveBoundedIntegerOption(
      options.entityLimit,
      DEFAULT_ENTITY_LIMIT,
      "Wikidata entityLimit",
      1,
      10,
    ),
    cache: new WikidataCache({ maxEntries: cacheMaxEntries, ttlMs: cacheTtlMs }),
  };
}

// Runs title or IMDb ID search through Wikidata without requiring credentials.
// Выполняет поиск по названию или IMDb ID через Wikidata без credentials.
async function searchWikidata(
  config: WikidataClientConfig,
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

  const entities = await searchWikidataEntities(config, query, context);

  return entities
    .map((entity) => mapEntityToItem(config, entity, query, context))
    .filter((item): item is MediaItem => item !== undefined)
    .map((item) => createSearchResult(item, context.debug));
}

// Loads details by IMDb ID when the selected search result exposes one.
// Загружает детали по IMDb ID, если выбранный результат поиска его содержит.
async function getWikidataDetails(
  config: WikidataClientConfig,
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
  config: WikidataClientConfig,
  imdbId: string,
  type: MediaType | undefined,
  context: ProviderContext,
): Promise<MediaDetails | null> {
  const entity = await getWikidataEntityByImdbId(config, imdbId, context);
  const item = entity
    ? mapEntityToItem(config, entity, { ids: { imdb: imdbId }, type }, context)
    : undefined;

  return item ? itemToDetails(item) : null;
}

// Maps a Wikidata entity into the normalized compact media model.
// Преобразует Wikidata entity в нормализованную compact media model.
function mapEntityToItem(
  config: WikidataClientConfig,
  entity: WikidataEntity,
  query: Pick<ProviderSearchQuery, "title" | "type" | "year" | "ids">,
  context: ProviderContext,
): MediaItem | undefined {
  const type = getMediaType(entity);

  if (!type || (query.type && query.type !== type)) {
    return undefined;
  }

  const title = getLabel(entity, context.language ?? config.language);

  if (!title || (query.title && !isRelevantWikidataTitleMatch(title, query.title))) {
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
  return entity.labels?.[normalizeWikidataLanguage(language)]?.value ?? entity.labels?.en?.value;
}

// Reads localized entity description with English fallback.
// Читает локализованное description entity с fallback на English.
function getDescription(entity: WikidataEntity, language: string): string | undefined {
  return (
    entity.descriptions?.[normalizeWikidataLanguage(language)]?.value ??
    entity.descriptions?.en?.value
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
  const url =
    filename?.startsWith("http://") || filename?.startsWith("https://")
      ? filename
      : filename
        ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
            filename.replaceAll(" ", "_"),
          )}`
        : undefined;

  return createProviderImage(url, "poster", PROVIDER_NAME);
}

// Extracts a four-digit year from an ISO-like date.
// Достает четырехзначный год из ISO-like date.
function getYear(date: string | undefined): number | undefined {
  const year = date?.slice(0, 4);

  return year && /^\d{4}$/.test(year) ? Number(year) : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
