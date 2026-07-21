import { ProviderError, type ProviderContext, type ProviderSearchQuery } from "@media-engine/core";
import { fetchJson, ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { WikidataCache } from "./cache.js";
import {
  normalizeWikidataEntityId,
  selectWikidataEntityIds,
  type WikidataSearchEntry,
} from "./candidates.js";

const PROVIDER_NAME = "wikidata";
const DEFAULT_LANGUAGE = "en";
const MAX_RESPONSE_BYTES = 256 * 1_024;

export interface WikidataClientConfig {
  baseUrl: string;
  sparqlUrl: string;
  language: string;
  userAgent: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
  entityLimit: number;
  cache: WikidataCache<WikidataEntity>;
}

export interface WikidataEntity {
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

export type WikidataClaimValue =
  | string
  | {
      id?: string;
      time?: string;
      amount?: string;
      text?: string;
    };

interface WikidataSearchResponse {
  search?: WikidataSearchEntry[];
}

interface WikidataSparqlResponse {
  results?: {
    bindings?: WikidataSparqlBinding[];
  };
}

interface WikidataSparqlBinding {
  item?: WikidataSparqlValue;
  instances?: WikidataSparqlValue;
  imdb?: WikidataSparqlValue;
  releaseDate?: WikidataSparqlValue;
  image?: WikidataSparqlValue;
  originalTitle?: WikidataSparqlValue;
  requestedLabel?: WikidataSparqlValue;
  englishLabel?: WikidataSparqlValue;
  requestedDescription?: WikidataSparqlValue;
  englishDescription?: WikidataSparqlValue;
}

interface WikidataSparqlValue {
  value?: string;
}

export async function searchWikidataEntities(
  config: WikidataClientConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<WikidataEntity[]> {
  const entityIds = await searchEntityIds(config, query, context);

  return getEntities(config, entityIds, context);
}

export async function getWikidataEntityByImdbId(
  config: WikidataClientConfig,
  imdbId: string,
  context: ProviderContext,
): Promise<WikidataEntity | undefined> {
  const cachedEntityId = config.cache.getImdbEntityId(imdbId);

  if (cachedEntityId === null) {
    return undefined;
  }

  if (cachedEntityId !== undefined) {
    return (await getEntities(config, [cachedEntityId], context))[0];
  }

  const languages = getRequestedLanguages(context.language ?? config.language);
  const response = await requestSparql(
    config,
    createSelectedPropertyQuery(
      `?item wdt:P345 "${escapeSparqlString(imdbId)}".`,
      languages,
      "LIMIT 1",
    ),
    context,
  );
  const entity = parseSparqlEntities(response, languages)[0];

  config.cache.setImdbEntityId(imdbId, entity?.id ?? null);

  if (entity) {
    config.cache.setEntity(createLanguageKey(languages), entity.id, entity);
  }

  return entity;
}

async function searchEntityIds(
  config: WikidataClientConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<string[]> {
  const url = new URL(`${config.baseUrl}/w/api.php`);
  const language = normalizeWikidataLanguage(query.language ?? context.language ?? config.language);

  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("type", "item");
  url.searchParams.set("language", language);
  url.searchParams.set("uselang", language);
  url.searchParams.set("search", query.title ?? "");
  url.searchParams.set("limit", String(config.searchLimit));

  const response = await requestJson<WikidataSearchResponse>(config, url, context);

  if (!Array.isArray(response.search)) {
    throw createInvalidResponseError("search entries");
  }

  return selectWikidataEntityIds(response.search, query, config.entityLimit);
}

async function getEntities(
  config: WikidataClientConfig,
  entityIds: string[],
  context: ProviderContext,
): Promise<WikidataEntity[]> {
  if (!entityIds.length) {
    return [];
  }

  const languages = getRequestedLanguages(context.language ?? config.language);
  const languageKey = createLanguageKey(languages);
  const entitiesById = new Map<string, WikidataEntity>();
  const missingIds: string[] = [];

  for (const entityId of entityIds) {
    const cached = config.cache.getEntity(languageKey, entityId);

    if (cached === undefined) {
      missingIds.push(entityId);
    } else if (cached !== null) {
      entitiesById.set(entityId, cached);
    }
  }

  if (missingIds.length) {
    const values = missingIds.map((entityId) => `wd:${entityId}`).join(" ");
    const response = await requestSparql(
      config,
      createSelectedPropertyQuery(`VALUES ?item { ${values} }`, languages),
      context,
    );
    const fetchedEntities = parseSparqlEntities(response, languages);
    const expectedIds = new Set(missingIds);

    if (fetchedEntities.some((entity) => !expectedIds.has(entity.id))) {
      throw createInvalidResponseError("requested entity IDs");
    }

    const fetchedById = new Map(fetchedEntities.map((entity) => [entity.id, entity]));

    for (const entityId of missingIds) {
      const entity = fetchedById.get(entityId) ?? null;

      config.cache.setEntity(languageKey, entityId, entity);

      if (entity) {
        const imdbId = getEntityImdbId(entity);

        entitiesById.set(entityId, entity);

        if (imdbId) {
          config.cache.setImdbEntityId(imdbId, entityId);
        }
      }
    }
  }

  return entityIds.flatMap((entityId) => {
    const entity = entitiesById.get(entityId);
    return entity ? [entity] : [];
  });
}

function createSelectedPropertyQuery(selector: string, languages: string[], suffix = ""): string {
  const requestedLanguage = languages[0] ?? DEFAULT_LANGUAGE;

  return `SELECT ?item
    (GROUP_CONCAT(DISTINCT STR(?instanceValue); separator="|") AS ?instances)
    (SAMPLE(?imdbValue) AS ?imdb)
    (MIN(?releaseValue) AS ?releaseDate)
    (SAMPLE(?imageValue) AS ?image)
    (SAMPLE(?originalValue) AS ?originalTitle)
    (SAMPLE(?requestedLabelValue) AS ?requestedLabel)
    (SAMPLE(?englishLabelValue) AS ?englishLabel)
    (SAMPLE(?requestedDescriptionValue) AS ?requestedDescription)
    (SAMPLE(?englishDescriptionValue) AS ?englishDescription)
  WHERE {
    ${selector}
    OPTIONAL { ?item wdt:P31 ?instanceValue. }
    OPTIONAL { ?item wdt:P345 ?imdbValue. }
    OPTIONAL { ?item wdt:P577 ?releaseValue. }
    OPTIONAL { ?item wdt:P18 ?imageValue. }
    OPTIONAL { ?item wdt:P1476 ?originalValue. }
    OPTIONAL {
      ?item rdfs:label ?requestedLabelValue.
      FILTER(LANG(?requestedLabelValue) = "${requestedLanguage}")
    }
    OPTIONAL {
      ?item rdfs:label ?englishLabelValue.
      FILTER(LANG(?englishLabelValue) = "en")
    }
    OPTIONAL {
      ?item schema:description ?requestedDescriptionValue.
      FILTER(LANG(?requestedDescriptionValue) = "${requestedLanguage}")
    }
    OPTIONAL {
      ?item schema:description ?englishDescriptionValue.
      FILTER(LANG(?englishDescriptionValue) = "en")
    }
  }
  GROUP BY ?item
  ${suffix}`;
}

function mapSparqlBinding(
  binding: WikidataSparqlBinding | undefined,
  languages: string[],
): WikidataEntity | undefined {
  const entityId = normalizeWikidataEntityId(binding?.item?.value?.split("/").at(-1));

  if (!binding || !entityId) {
    return undefined;
  }

  const requestedLanguage = languages[0] ?? DEFAULT_LANGUAGE;
  const labels = createLocalizedValues(
    requestedLanguage,
    binding.requestedLabel?.value,
    binding.englishLabel?.value,
  );
  const descriptions = createLocalizedValues(
    requestedLanguage,
    binding.requestedDescription?.value,
    binding.englishDescription?.value,
  );
  const claims: Record<string, WikidataClaim[]> = {};

  setClaims(
    claims,
    "P31",
    (binding.instances?.value ?? "")
      .split("|")
      .map((value) => normalizeWikidataEntityId(value.split("/").at(-1)))
      .filter((value): value is string => value !== undefined)
      .map((id) => ({ id })),
  );
  setClaims(claims, "P345", compactValues(binding.imdb?.value));
  setClaims(
    claims,
    "P577",
    compactValues(binding.releaseDate?.value).map((time) => ({ time })),
  );
  setClaims(claims, "P18", compactValues(binding.image?.value));
  setClaims(
    claims,
    "P1476",
    compactValues(binding.originalTitle?.value).map((text) => ({ text })),
  );

  return { id: entityId, labels, descriptions, claims };
}

function parseSparqlEntities(
  response: WikidataSparqlResponse,
  languages: string[],
): WikidataEntity[] {
  const bindings = response.results?.bindings;

  if (!Array.isArray(bindings)) {
    throw createInvalidResponseError("SPARQL bindings");
  }

  const entities = bindings.map((binding) => mapSparqlBinding(binding, languages));

  if (entities.some((entity) => entity === undefined)) {
    throw createInvalidResponseError("canonical entity IDs");
  }

  return entities as WikidataEntity[];
}

function createLocalizedValues(
  requestedLanguage: string,
  requestedValue: string | undefined,
  englishValue: string | undefined,
): Record<string, WikidataTextValue> | undefined {
  const values: Record<string, WikidataTextValue> = {};

  if (requestedValue) {
    values[requestedLanguage] = { value: requestedValue };
  }

  if (englishValue) {
    values.en = { value: englishValue };
  }

  return Object.keys(values).length ? values : undefined;
}

function setClaims(
  claims: Record<string, WikidataClaim[]>,
  property: string,
  values: WikidataClaimValue[],
): void {
  if (values.length) {
    claims[property] = values.map((value) => ({
      mainsnak: { datavalue: { value } },
    }));
  }
}

function compactValues(value: string | undefined): string[] {
  return value ? [value] : [];
}

function getEntityImdbId(entity: WikidataEntity): string | undefined {
  const value = entity.claims?.P345?.[0]?.mainsnak?.datavalue?.value;

  return typeof value === "string" ? value : undefined;
}

function requestSparql(
  config: WikidataClientConfig,
  query: string,
  context: ProviderContext,
): Promise<WikidataSparqlResponse> {
  const url = new URL(config.sparqlUrl);

  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  return requestJson<WikidataSparqlResponse>(config, url, context);
}

function requestJson<T>(
  config: WikidataClientConfig,
  url: URL,
  context: ProviderContext,
): Promise<T> {
  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    context,
    fetch: config.fetch,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    rateLimitGate: config.rateLimitGate,
    init: {
      headers: {
        accept: "application/json",
        "user-agent": config.userAgent,
      },
    },
  });
}

export function normalizeWikidataLanguage(language: string): string {
  const primary = language.split("-")[0]?.trim().toLocaleLowerCase();

  return primary && /^[a-z]{2,12}$/.test(primary) ? primary : DEFAULT_LANGUAGE;
}

function getRequestedLanguages(language: string): string[] {
  return [...new Set([normalizeWikidataLanguage(language), DEFAULT_LANGUAGE])];
}

function createLanguageKey(languages: string[]): string {
  return languages.join("|");
}

function escapeSparqlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function createInvalidResponseError(field: string): ProviderError {
  return new ProviderError({
    provider: PROVIDER_NAME,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${PROVIDER_NAME}" returned invalid ${field}.`,
    retryable: false,
  });
}
