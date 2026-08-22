import { ProviderError, type ProviderContext } from "@media-engine/core";
import { fetchJson, getProviderHttpStatus } from "../shared/index.js";
import type { FilmixStreamingConfig } from "./config.js";

const SERIES_SECTION = 7;
const BRACKETED_QUALITIES = /_\[([0-9,]+)\]\.mp4(?=$|[?#])/u;
const PRINTF_QUALITY = /_%s\.mp4(?=$|[?#])/u;

export interface FilmixPostSummary {
  id: number;
  title: string;
  originalTitle?: string;
  year: number;
  section: number;
  altName?: string;
  type: "movie" | "series";
}

export interface FilmixStream {
  translation: string;
  link: string;
  qualities: number[];
}

export interface FilmixEpisode extends FilmixStream {
  number: number;
}

export interface FilmixSeason {
  number: number;
  translations: Array<{ name: string; episodes: FilmixEpisode[] }>;
}

export interface FilmixPost extends FilmixPostSummary {
  movies: FilmixStream[];
  seasons: FilmixSeason[];
}

export async function searchFilmixPosts(
  config: FilmixStreamingConfig,
  title: string,
  context: ProviderContext,
): Promise<FilmixPostSummary[]> {
  const url = createApiUrl(config, "search");
  url.searchParams.set("story", title);

  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxResponseBytes: config.maxResponseBytes,
    init: { headers: createHeaders(config) },
  });

  return parseFilmixSearchResponse(config.name, payload, config.searchResultLimit);
}

export async function loadFilmixPost(
  config: FilmixStreamingConfig,
  postId: number,
  context: ProviderContext,
): Promise<FilmixPost | null> {
  const url = createApiUrl(config, `post/${postId}`);

  try {
    const payload = await fetchJson<unknown>({
      provider: config.name,
      url,
      context,
      fetch: config.fetch,
      rateLimitGate: config.rateLimitGate,
      maxResponseBytes: config.maxResponseBytes,
      init: { headers: createHeaders(config) },
    });

    return parseFilmixPost(config.name, payload, config);
  } catch (error) {
    if (getProviderHttpStatus(error) === 404) return null;
    throw error;
  }
}

export function parseFilmixSearchResponse(
  provider: string,
  value: unknown,
  limit: number,
): FilmixPostSummary[] {
  if (!Array.isArray(value)) throw invalidResponse(provider);

  const posts = value.slice(0, limit).flatMap((entry) => {
    const post = parsePostSummary(entry);
    return post ? [post] : [];
  });

  if (value.length > 0 && posts.length === 0) throw invalidResponse(provider);
  return posts;
}

export function parseFilmixPost(
  provider: string,
  value: unknown,
  limits: Pick<FilmixStreamingConfig, "seasonLimit" | "translationLimit" | "episodeLimit">,
): FilmixPost {
  const summary = parsePostSummary(value);
  if (!summary || !isRecord(value) || !isRecord(value.player_links)) {
    throw invalidResponse(provider);
  }

  const movieValue = value.player_links.movie;
  const playlistValue = value.player_links.playlist;
  const movies = parseMovies(movieValue, limits.translationLimit);
  const seasons = parseSeasons(
    playlistValue,
    limits.seasonLimit,
    limits.translationLimit,
    limits.episodeLimit,
  );

  if (summary.type === "movie" && movieValue !== undefined && !Array.isArray(movieValue)) {
    throw invalidResponse(provider);
  }
  if (summary.type === "series" && playlistValue !== undefined && !isRecord(playlistValue)) {
    throw invalidResponse(provider);
  }
  if (
    (Array.isArray(movieValue) && movieValue.length > 0 && movies.length === 0) ||
    (isRecord(playlistValue) && Object.keys(playlistValue).length > 0 && seasons.length === 0)
  ) {
    throw invalidResponse(provider);
  }

  return { ...summary, movies, seasons };
}

export function createFilmixSourceUrl(
  config: Pick<FilmixStreamingConfig, "siteBaseUrl">,
  post: FilmixPostSummary,
): string | undefined {
  if (!post.altName || !/^[\p{L}\p{N}_-]{1,300}$/u.test(post.altName)) return undefined;
  const kind = post.type === "series" ? "seria" : "film";
  return new URL(`${kind}/${post.id}-${post.altName}.html`, `${config.siteBaseUrl}/`).href;
}

function createApiUrl(config: FilmixStreamingConfig, path: string): URL {
  const url = new URL(`${config.baseUrl}/${path}`);
  url.searchParams.set("user_dev_id", config.deviceId);
  url.searchParams.set("user_dev_name", "media-engine");
  url.searchParams.set("user_dev_vendor", "media-engine");
  url.searchParams.set("user_dev_os", "node");
  url.searchParams.set("user_dev_apk", "2.0.9");
  return url;
}

function parsePostSummary(value: unknown): FilmixPostSummary | undefined {
  if (!isRecord(value)) return undefined;

  const id = readInteger(value.id, 1, Number.MAX_SAFE_INTEGER);
  const title = readRequiredString(value.title, 500);
  const originalTitle = readNullableString(value.original_title, 500);
  const year = readInteger(value.year, 1_800, 3_000);
  const section = readInteger(value.section, 0, 10_000);
  const altName = readNullableString(value.alt_name, 500);

  if (
    id === undefined ||
    !title ||
    originalTitle === false ||
    year === undefined ||
    section === undefined ||
    altName === false
  ) {
    return undefined;
  }

  return {
    id,
    title,
    ...(originalTitle ? { originalTitle } : {}),
    year,
    section,
    ...(altName ? { altName } : {}),
    type: section === SERIES_SECTION ? "series" : "movie",
  };
}

function parseMovies(value: unknown, limit: number): FilmixStream[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).flatMap((entry) => {
    const stream = parseStream(entry, undefined);
    return stream ? [stream] : [];
  });
}

function parseSeasons(
  value: unknown,
  seasonLimit: number,
  translationLimit: number,
  episodeLimit: number,
): FilmixSeason[] {
  if (!isRecord(value)) return [];

  return Object.entries(value)
    .slice(0, seasonLimit)
    .flatMap(([seasonKey, seasonValue]) => {
      const number = readPositiveKey(seasonKey);
      if (number === undefined || !isRecord(seasonValue)) return [];

      const translations = Object.entries(seasonValue)
        .slice(0, translationLimit)
        .flatMap(([name, episodesValue]) => {
          const translation = name.trim().slice(0, 500);
          if (!translation) return [];
          const episodes = parseEpisodes(episodesValue, translation, episodeLimit);
          return episodes.length > 0 ? [{ name: translation, episodes }] : [];
        });

      return translations.length > 0 ? [{ number, translations }] : [];
    })
    .sort((left, right) => left.number - right.number);
}

function parseEpisodes(value: unknown, translation: string, limit: number): FilmixEpisode[] {
  if (Array.isArray(value)) {
    return value.slice(0, limit).flatMap((entry, index) => {
      const stream = parseStream(entry, translation);
      return stream ? [{ ...stream, number: index + 1 }] : [];
    });
  }
  if (!isRecord(value)) return [];

  return Object.entries(value)
    .slice(0, limit)
    .flatMap(([episodeKey, entry]) => {
      const number = readPositiveKey(episodeKey);
      const stream = parseStream(entry, translation);
      return number !== undefined && stream ? [{ ...stream, number }] : [];
    })
    .sort((left, right) => left.number - right.number);
}

function parseStream(
  value: unknown,
  fallbackTranslation: string | undefined,
): FilmixStream | undefined {
  if (!isRecord(value)) return undefined;
  const translationValue = readNullableString(value.translation, 500);
  const translation = translationValue || fallbackTranslation;
  const link = readRequiredString(value.link, 8_192);
  const explicitQualities = parseExplicitQualities(value.qualities);

  if (translationValue === false || !translation || !link || explicitQualities === false) {
    return undefined;
  }

  const qualities = explicitQualities ?? parseLinkQualities(link);
  return { translation, link, qualities };
}

function parseExplicitQualities(value: unknown): number[] | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return false;
  const qualities = value.flatMap((quality) => {
    const parsed = readInteger(quality, 1, 10_000);
    return parsed === undefined ? [] : [parsed];
  });
  return value.length > 0 && qualities.length === 0 ? false : [...new Set(qualities)];
}

function parseLinkQualities(link: string): number[] {
  const match = BRACKETED_QUALITIES.exec(link);
  if (!match?.[1]) return [];
  return [
    ...new Set(
      match[1].split(",").flatMap((value) => {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? [parsed] : [];
      }),
    ),
  ];
}

export function resolveFilmixQualityLink(link: string, quality: number): string | undefined {
  if (!Number.isSafeInteger(quality) || quality <= 0) return undefined;
  if (BRACKETED_QUALITIES.test(link)) {
    return link.replace(BRACKETED_QUALITIES, `_${quality}.mp4`);
  }
  if (PRINTF_QUALITY.test(link)) {
    return link.replace(PRINTF_QUALITY, `_${quality}.mp4`);
  }
  return undefined;
}

function createHeaders(config: FilmixStreamingConfig): HeadersInit {
  return { Accept: "application/json", "User-Agent": config.userAgent };
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function readPositiveKey(value: string): number | undefined {
  return /^(?:[1-9]\d*)$/u.test(value) ? readInteger(Number(value), 1, 100_000) : undefined;
}

function readRequiredString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function readNullableString(value: unknown, maxLength: number): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid Filmix response.`,
    retryable: false,
  });
}
