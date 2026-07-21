import type {
  ExternalIds,
  MediaItem,
  MediaProvider,
  MediaStatus,
  ProviderContext,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
  SeriesDetails,
} from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  fetchJson,
  getProviderHttpStatus,
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import {
  createProviderImage,
  mapGenreNames,
  normalizeProviderSearchText,
} from "../shared/mapping.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";

const PROVIDER_NAME = "tvmaze";
const DEFAULT_BASE_URL = "https://api.tvmaze.com";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_ALIAS_LIMIT = 30;

export interface TvMazeProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  version?: string;
  searchLimit?: number;
  aliasLimit?: number;
  userAgent?: string;
}

interface TvMazeConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  searchLimit: number;
  aliasLimit: number;
  userAgent: string;
  rateLimitGate: ProviderRateLimitGate;
}

interface TvMazeSearchEntry {
  score?: number;
  show?: TvMazeShow;
}

interface TvMazeShow {
  id?: number;
  url?: string | null;
  name?: string | null;
  type?: string | null;
  language?: string | null;
  genres?: string[];
  status?: string | null;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  summary?: string | null;
  rating?: { average?: number | null } | null;
  externals?: { imdb?: string | null } | null;
  image?: { medium?: string | null; original?: string | null } | null;
  network?: TvMazeChannel | null;
  webChannel?: TvMazeChannel | null;
}

interface TvMazeChannel {
  country?: { name?: string | null } | null;
}

interface TvMazeAlias {
  name?: string | null;
}

// Creates a no-token fallback identity provider for series backed by TVmaze's public API.
// Создает no-token fallback identity provider сериалов на публичном API TVmaze.
export function tvMazeProvider(options: TvMazeProviderOptions = {}): MediaProvider {
  const config = createConfig(options);

  return {
    name: PROVIDER_NAME,
    version: options.version,
    kind: "metadata",
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["series"],
      searchEnrichment: false,
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
        titleDiscovery: "fallback",
      },
      details: { byExternalIds: ["imdb"] },
      features: ["posters", "ratings", "genres", "alternative_titles"],
    },
    search: (query, context) => searchTvMaze(config, query, context),
    getDetails: (query, context) => getTvMazeDetails(config, query.ids?.imdb, context),
  };
}

function createConfig(options: TvMazeProviderOptions): TvMazeConfig {
  const userAgent = options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT;

  return {
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch,
    searchLimit: resolveBoundedIntegerOption(
      options.searchLimit,
      DEFAULT_SEARCH_LIMIT,
      "TVmaze searchLimit",
      1,
      100,
    ),
    aliasLimit: resolveBoundedIntegerOption(
      options.aliasLimit,
      DEFAULT_ALIAS_LIMIT,
      "TVmaze aliasLimit",
      0,
      100,
    ),
    userAgent,
    rateLimitGate: new ProviderRateLimitGate(),
  };
}

async function searchTvMaze(
  config: TvMazeConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type && query.type !== "series") {
    return [];
  }

  if (query.ids?.imdb) {
    const details = await getTvMazeDetails(config, query.ids.imdb, context);
    return details ? [detailsToSearchResult(details)] : [];
  }

  if (!query.title?.trim()) {
    return [];
  }

  const url = new URL(`${config.baseUrl}/search/shows`);
  url.searchParams.set("q", query.title);
  const response = await requestJson<TvMazeSearchEntry[]>(config, url, context);
  const candidates = response
    .map((entry) => createSearchCandidate(entry))
    .filter((candidate): candidate is TvMazeSearchCandidate => candidate !== undefined)
    .filter(({ item }) => query.year === undefined || item.year === query.year)
    .slice(0, query.limit ?? config.searchLimit);

  if (candidates[0] && shouldLoadAliases(candidates[0].item, query.title)) {
    candidates[0].aliases = await loadAliases(config, candidates[0].show.id!, context);
    candidates[0].item = mapShow(candidates[0].show, candidates[0].aliases)!;
  }

  return candidates.map((candidate) => ({
    provider: PROVIDER_NAME,
    item: candidate.item,
    confidence: normalizeConfidence(candidate.score),
    source: createProviderSource(candidate.show),
    raw: context.debug
      ? { score: candidate.score, show: candidate.show, aliases: candidate.aliases }
      : undefined,
  }));
}

interface TvMazeSearchCandidate {
  score: number | undefined;
  show: TvMazeShow;
  aliases?: string[];
  item: MediaItem;
}

function createSearchCandidate(entry: TvMazeSearchEntry): TvMazeSearchCandidate | undefined {
  const item = entry.show ? mapShow(entry.show) : undefined;
  return item && entry.show ? { score: entry.score, show: entry.show, item } : undefined;
}

async function getTvMazeDetails(
  config: TvMazeConfig,
  imdbId: string | undefined,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (!imdbId) {
    return null;
  }

  const url = new URL(`${config.baseUrl}/lookup/shows`);
  url.searchParams.set("imdb", imdbId);

  try {
    const show = await requestJson<TvMazeShow>(config, url, context);
    const details = mapDetails(show);

    return details
      ? {
          provider: PROVIDER_NAME,
          details,
          confidence: 1,
          source: createProviderSource(show),
          raw: context.debug ? show : undefined,
        }
      : null;
  } catch (error) {
    rethrowIfProviderAborted(context, error);

    if (getProviderHttpStatus(error) === 404) {
      return null;
    }

    throw error;
  }
}

async function loadAliases(
  config: TvMazeConfig,
  showId: number,
  context: ProviderContext,
): Promise<string[] | undefined> {
  if (config.aliasLimit === 0) {
    return undefined;
  }

  const response = await requestJson<TvMazeAlias[]>(
    config,
    new URL(`${config.baseUrl}/shows/${showId}/akas`),
    context,
  );
  const aliases = [
    ...new Set(
      response
        .map((alias) => alias.name?.trim())
        .filter((alias): alias is string => Boolean(alias)),
    ),
  ].slice(0, config.aliasLimit);

  return aliases.length > 0 ? aliases : undefined;
}

function mapShow(show: TvMazeShow, aliases?: string[]): MediaItem | undefined {
  const title = show.name?.trim();
  const imdb = show.externals?.imdb?.trim();

  if (!show.id || !title || !imdb) {
    return undefined;
  }

  const alternativeTitles = aliases?.filter((alias) => alias !== title);

  return {
    id: `${PROVIDER_NAME}-series-${show.id}`,
    type: "series",
    title,
    alternativeTitles: alternativeTitles?.length ? alternativeTitles : undefined,
    year: parseYear(show.premiered),
    releaseDate: normalizeDate(show.premiered),
    description: normalizeHtmlText(show.summary),
    poster: createProviderImage(
      show.image?.original ?? show.image?.medium,
      "poster",
      PROVIDER_NAME,
    ),
    genres: mapGenreNames(show.genres, PROVIDER_NAME),
    ratings: mapRating(show.rating?.average),
    ids: { imdb },
  };
}

function mapDetails(show: TvMazeShow): SeriesDetails | null {
  const item = mapShow(show);

  if (!item) {
    return null;
  }

  const countries = [show.network?.country?.name, show.webChannel?.country?.name]
    .filter((country): country is string => Boolean(country?.trim()))
    .map((country) => country.trim());

  return {
    ...item,
    type: "series",
    status: mapStatus(show.status),
    runtimeMinutes: normalizePositiveInteger(show.averageRuntime ?? show.runtime),
    countries: countries.length > 0 ? [...new Set(countries)] : undefined,
    images: item.poster ? [item.poster] : undefined,
    sourceProviders: [createProviderSource(show)],
  };
}

function detailsToSearchResult(details: ProviderDetailsResult): ProviderSearchResult {
  const value = details.details;
  const item: MediaItem = {
    id: value.id,
    type: value.type,
    title: value.title,
    originalTitle: value.originalTitle,
    alternativeTitles: value.alternativeTitles,
    year: value.year,
    releaseDate: value.releaseDate,
    description: value.description,
    shortDescription: value.shortDescription,
    poster: value.poster,
    backdrop: value.backdrop,
    genres: value.genres,
    ratings: value.ratings,
    ids: value.ids,
  };

  return {
    provider: PROVIDER_NAME,
    item,
    confidence: 1,
    source: details.source,
    raw: details.raw,
  };
}

function createProviderSource(show: TvMazeShow): ProviderSource {
  const ids: ExternalIds = { imdb: show.externals?.imdb?.trim() || undefined };

  return {
    provider: PROVIDER_NAME,
    ids,
    url: normalizeProviderOutputUrl(show.url),
  };
}

function shouldLoadAliases(item: MediaItem, queryTitle: string): boolean {
  const queryTokens = new Set(normalizeProviderSearchText(queryTitle).split(" ").filter(Boolean));
  const titleTokens = new Set(normalizeProviderSearchText(item.title).split(" ").filter(Boolean));

  return ![...queryTokens].some((token) => titleTokens.has(token));
}

function normalizeConfidence(value: number | undefined): number {
  // TVmaze search scores are relevance values rather than calibrated probabilities, so a
  // fallback-only result must not outrank an equally strong identity on confidence alone.
  return Number.isFinite(value) ? Math.max(0, Math.min(0.9, value!)) : 0.5;
}

function mapRating(value: number | null | undefined): Rating[] | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? [{ source: "tvmaze", value, max: 10 }]
    : undefined;
}

function mapStatus(value: string | null | undefined): MediaStatus | undefined {
  switch (value?.toLocaleLowerCase()) {
    case "running":
      return "ongoing";
    case "ended":
      return "ended";
    case "in development":
      return "in_production";
    case "to be determined":
      return "unknown";
    default:
      return undefined;
  }
}

function normalizeHtmlText(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(code, 10))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized || undefined;
}

function decodeCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

function parseYear(value: string | null | undefined): number | undefined {
  const year = value?.match(/^(\d{4})/)?.[1];
  return year ? Number(year) : undefined;
}

function normalizeDate(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function normalizePositiveInteger(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function requestJson<T>(
  config: TvMazeConfig,
  url: URL,
  context: ProviderContext,
): Promise<T> {
  return fetchJson<T>({
    provider: PROVIDER_NAME,
    url,
    fetch: config.fetch,
    context,
    rateLimitGate: config.rateLimitGate,
    init: {
      headers: {
        accept: "application/json",
        "user-agent": config.userAgent,
      },
    },
  });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
