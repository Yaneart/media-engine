import type {
  AnimeDetails,
  AnimeKind,
  ExternalIds,
  Genre,
  Image,
  MediaItem,
  MediaProvider,
  MediaStatus,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
  ProviderSource,
  Rating,
} from "@media-engine/core";
import {
  fetchJson,
  normalizeProviderOutputUrl,
  ProviderRateLimitGate,
  type ProviderFetch,
} from "../shared/index.js";
import { createProviderImage } from "../shared/mapping.js";
import { parseAniListGraphQlData } from "./graphql.js";

const PROVIDER_NAME = "anilist";
const DEFAULT_BASE_URL = "https://graphql.anilist.co";
const DEFAULT_SEARCH_LIMIT = 10;
const MEDIA_FIELDS = `
  id idMal title { romaji english native } synonyms format status episodes duration
  startDate { year month day } endDate { year month day }
  description(asHtml: false) averageScore popularity isAdult countryOfOrigin
  coverImage { extraLarge large } genres siteUrl
`;

export interface AniListProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
  searchLimit?: number;
  includeAdult?: boolean;
}

interface AniListConfig {
  baseUrl: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
  includeAdult: boolean;
}

interface GraphQlResponse {
  data: { Page?: { media?: AniListMedia[] }; Media?: AniListMedia | null };
}

interface AniListMedia {
  id?: number;
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[];
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  startDate?: AniListDate;
  endDate?: AniListDate;
  description?: string | null;
  averageScore?: number | null;
  popularity?: number | null;
  isAdult?: boolean;
  countryOfOrigin?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null };
  genres?: string[];
  siteUrl?: string | null;
}

interface AniListDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

// Creates a public no-token AniList anime metadata provider.
// Создает публичный no-token AniList anime metadata provider.
export function aniListProvider(options: AniListProviderOptions = {}): MediaProvider {
  const config: AniListConfig = {
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetch: options.fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit: options.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    includeAdult: options.includeAdult ?? false,
  };

  if (!Number.isInteger(config.searchLimit) || config.searchLimit <= 0 || config.searchLimit > 50) {
    throw new RangeError("AniList searchLimit must be an integer between 1 and 50.");
  }

  return {
    name: PROVIDER_NAME,
    kind: "metadata",
    searchPosterMatchesDetails: true,
    capabilities: {
      mediaTypes: ["anime"],
      search: { byTitle: true, byExternalIds: ["aniList", "myAnimeList"] },
      details: { byExternalIds: ["aniList", "myAnimeList"] },
      features: ["posters", "ratings", "genres"],
    },
    search: (query, context) => searchAniList(config, query, context),
    getDetails: (query, context) => getAniListDetails(config, query, context),
  };
}

async function searchAniList(
  config: AniListConfig,
  query: ProviderSearchQuery,
  context: ProviderContext,
): Promise<ProviderSearchResult[]> {
  if (query.type && query.type !== "anime") return [];

  if (query.ids?.aniList || query.ids?.myAnimeList) {
    const details = await loadDetails(config, query.ids, context);
    return details ? [toSearchResult(details, context.debug)] : [];
  }

  if (!query.title?.trim()) return [];

  const response = await request(
    config,
    `query ($search: String!, $perPage: Int!, $isAdult: Boolean) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME, isAdult: $isAdult, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
      }
    }`,
    {
      search: query.title,
      perPage: Math.min(query.limit ?? config.searchLimit, 50),
      isAdult: config.includeAdult ? undefined : false,
    },
    context,
  );

  return (response.data?.Page?.media ?? [])
    .map(mapMediaItem)
    .filter((item): item is MediaItem => item !== undefined)
    .filter((item) => query.year === undefined || item.year === query.year)
    .map((item) => toSearchResult(item, context.debug));
}

async function getAniListDetails(
  config: AniListConfig,
  query: ProviderDetailsQuery,
  context: ProviderContext,
): Promise<ProviderDetailsResult | null> {
  if (query.type && query.type !== "anime") return null;
  const details = await loadDetails(config, query.ids ?? {}, context);
  return details
    ? {
        provider: PROVIDER_NAME,
        details,
        confidence: 1,
        source: createSource(details.ids),
        raw: context.debug ? details : undefined,
      }
    : null;
}

async function loadDetails(
  config: AniListConfig,
  ids: ExternalIds,
  context: ProviderContext,
): Promise<AnimeDetails | null> {
  if (!ids.aniList && !ids.myAnimeList) return null;
  const response = await request(
    config,
    `query ($id: Int, $idMal: Int) { Media(id: $id, idMal: $idMal, type: ANIME) { ${MEDIA_FIELDS} } }`,
    {
      id: ids.aniList ? Number(ids.aniList) : undefined,
      idMal: !ids.aniList && ids.myAnimeList ? Number(ids.myAnimeList) : undefined,
    },
    context,
  );
  const media = response.data?.Media;
  const item = media ? mapMediaItem(media) : undefined;
  return item && media ? mapDetails(item, media) : null;
}

function mapMediaItem(media: AniListMedia): MediaItem | undefined {
  if (!media.id || (!media.title?.romaji && !media.title?.english)) return undefined;
  const englishTitle = normalizeText(media.title.english);
  const romajiTitle = normalizeText(media.title.romaji);
  const title = englishTitle || romajiTitle;

  if (!title) return undefined;

  const candidates = [
    romajiTitle,
    englishTitle,
    normalizeText(media.title.native),
    ...(media.synonyms ?? []),
  ]
    .map((value) => normalizeText(value))
    .filter((value): value is string => Boolean(value));
  const alternativeTitles = [...new Set(candidates)].filter((value) => value !== title);
  const releaseDate = formatDate(media.startDate);

  return {
    id: `${PROVIDER_NAME}-anime-${media.id}`,
    type: "anime",
    title,
    originalTitle: romajiTitle,
    alternativeTitles: alternativeTitles.length ? alternativeTitles : undefined,
    year: media.startDate?.year ?? undefined,
    releaseDate,
    description: normalizeText(media.description),
    poster: mapPoster(media.coverImage),
    genres: mapGenres(media.genres),
    ratings: mapRating(media),
    ids: { aniList: String(media.id), myAnimeList: media.idMal ? String(media.idMal) : undefined },
  };
}

// Converts AniList's lightweight HTML descriptions into plain public text.
// Преобразует HTML-описания AniList в обычный публичный текст.
function normalizeText(value: string | null | undefined): string | undefined {
  const decoded = repairMojibake(value?.trim());
  const normalized = decoded
    ?.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized && !normalized.includes("\uFFFD") ? normalized : undefined;
}

// Repairs the common case where UTF-8 bytes were decoded as Latin-1 upstream.
function repairMojibake(value: string | undefined): string | undefined {
  if (!value || !/[ÃÂâ]/u.test(value)) return value;

  const windows1252Bytes = new Map<string, number>([
    ["€", 0x80],
    ["‚", 0x82],
    ["ƒ", 0x83],
    ["„", 0x84],
    ["…", 0x85],
    ["†", 0x86],
    ["‡", 0x87],
    ["ˆ", 0x88],
    ["‰", 0x89],
    ["Š", 0x8a],
    ["‹", 0x8b],
    ["Œ", 0x8c],
    ["Ž", 0x8e],
    ["‘", 0x91],
    ["’", 0x92],
    ["“", 0x93],
    ["”", 0x94],
    ["•", 0x95],
    ["–", 0x96],
    ["—", 0x97],
    ["˜", 0x98],
    ["™", 0x99],
    ["š", 0x9a],
    ["›", 0x9b],
    ["œ", 0x9c],
    ["ž", 0x9e],
    ["Ÿ", 0x9f],
  ]);
  const bytes = Uint8Array.from(
    value,
    (character) => windows1252Bytes.get(character) ?? character.charCodeAt(0),
  );
  const repaired = new TextDecoder("utf-8", { fatal: true });

  try {
    return repaired.decode(bytes);
  } catch {
    return value;
  }
}

function mapDetails(item: MediaItem, media: AniListMedia): AnimeDetails {
  return {
    ...item,
    type: "anime",
    status: mapStatus(media.status),
    runtimeMinutes: media.duration ?? undefined,
    countries: media.countryOfOrigin ? [media.countryOfOrigin] : undefined,
    languages: media.countryOfOrigin === "JP" ? ["ja"] : undefined,
    sourceProviders: [createSource(item.ids)],
    animeKind: mapKind(media.format),
    episodesCount: media.episodes ?? undefined,
    airedOn: formatDate(media.startDate),
    releasedOn: formatDate(media.endDate),
  };
}

function toSearchResult(item: MediaItem, debug: boolean | undefined): ProviderSearchResult {
  return {
    provider: PROVIDER_NAME,
    item,
    confidence: 1,
    source: createSource(item.ids),
    raw: debug ? item : undefined,
  };
}

function createSource(ids: ExternalIds | undefined): ProviderSource {
  return {
    provider: PROVIDER_NAME,
    ids,
    url: normalizeProviderOutputUrl(
      ids?.aniList ? `https://anilist.co/anime/${ids.aniList}` : undefined,
    ),
  };
}

function mapPoster(image: AniListMedia["coverImage"]): Image | undefined {
  const url = image?.extraLarge ?? image?.large;
  return createProviderImage(url, "poster", PROVIDER_NAME);
}

function mapGenres(values: string[] | undefined): Genre[] | undefined {
  return values?.length ? values.map((name) => ({ name, source: PROVIDER_NAME })) : undefined;
}

function mapRating(media: AniListMedia): Rating[] | undefined {
  return media.averageScore
    ? [
        {
          source: "aniList",
          value: media.averageScore,
          max: 100,
          votes: media.popularity ?? undefined,
        },
      ]
    : undefined;
}

function mapStatus(status: string | null | undefined): MediaStatus | undefined {
  if (status === "RELEASING") return "ongoing";
  if (status === "FINISHED") return "ended";
  if (status === "NOT_YET_RELEASED") return "announced";
  if (status === "CANCELLED") return "canceled";
  return undefined;
}

function mapKind(format: string | null | undefined): AnimeKind | undefined {
  if (format === "TV" || format === "TV_SHORT") return "tv";
  if (format === "MOVIE") return "movie";
  if (format === "OVA") return "ova";
  if (format === "ONA") return "ona";
  if (format === "SPECIAL") return "special";
  if (format === "MUSIC") return "music";
  return format ? "unknown" : undefined;
}

function formatDate(date: AniListDate | undefined): string | undefined {
  if (!date?.year) return undefined;
  return [date.year, date.month ?? 1, date.day ?? 1]
    .map((value, index) => (index ? String(value).padStart(2, "0") : String(value)))
    .join("-");
}

async function request(
  config: AniListConfig,
  query: string,
  variables: Record<string, unknown>,
  context: ProviderContext,
): Promise<GraphQlResponse> {
  const response = await fetchJson<unknown>({
    provider: PROVIDER_NAME,
    url: config.baseUrl,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    init: {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
  });

  return {
    data: parseAniListGraphQlData<GraphQlResponse["data"]>(response, config.rateLimitGate),
  };
}
