import { ProviderError, type MediaAvailability, type ProviderContext } from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import type { KodikStreamingConfig } from "./config.js";

const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 8_192;

export type KodikLookupKey = "kinopoisk_id" | "imdb_id" | "shikimori_id";

export interface KodikTranslation {
  id?: string;
  title: string;
  type?: string;
}

export interface KodikSeason {
  link?: string;
  episodes: Record<number, string>;
}

export interface KodikResult {
  id: string;
  type: string;
  link: string;
  title: string;
  originalTitle?: string;
  year?: number;
  kinopoiskId?: string;
  imdbId?: string;
  shikimoriId?: string;
  translation: KodikTranslation;
  quality?: string;
  blockedCountries: string[];
  blockedSeasons: Set<number>;
  seasons: Record<number, KodikSeason>;
}

export interface KodikSearchResult {
  results: KodikResult[];
  sourceUrl: string;
}

interface KodikLookup {
  key: KodikLookupKey;
  value: string;
}

export async function searchKodik(
  config: KodikStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<KodikSearchResult | null> {
  for (const lookup of resolveLookups(query)) {
    const requestUrl = createSearchUrl(config, lookup);
    let payload: unknown;
    try {
      payload = await fetchJson<unknown>({
        provider: config.name,
        url: requestUrl,
        context,
        fetch: config.fetch,
        rateLimitGate: config.rateLimitGate,
        maxRetries: 0,
        maxResponseBytes: config.maxResponseBytes,
        init: { headers: { Accept: "application/json", "User-Agent": config.userAgent } },
      });
    } catch (error) {
      throw redactRequestError(config.name, error);
    }
    const results = parseKodikResponse(config.name, payload, config.resultLimit);
    if (results.length > 0) {
      return { results, sourceUrl: new URL("/search", `${config.baseUrl}/`).href };
    }
  }
  return null;
}

function redactRequestError(provider: string, error: unknown): ProviderError {
  const code = error instanceof ProviderError ? error.code : "PROVIDER_UNAVAILABLE";
  return new ProviderError({
    provider,
    code,
    retryable: error instanceof ProviderError ? error.retryable : true,
    message: `Provider "${provider}" Kodik request failed (${code}).`,
  });
}

export function createSearchUrl(config: KodikStreamingConfig, lookup: KodikLookup): URL {
  const url = new URL("/search", `${config.baseUrl}/`);
  url.searchParams.set("token", config.apiKey);
  url.searchParams.set(lookup.key, lookup.value);
  url.searchParams.set("with_episodes", "true");
  url.searchParams.set("limit", String(config.resultLimit));
  return url;
}

export function parseKodikResponse(provider: string, value: unknown, limit: number): KodikResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) throw invalidResponse(provider);
  const results = value.results.slice(0, limit).flatMap((entry) => {
    const result = parseResult(entry);
    return result ? [result] : [];
  });
  if (value.results.length > 0 && results.length === 0) throw invalidResponse(provider);
  return results;
}

function resolveLookups(query: MediaAvailability["query"]): KodikLookup[] {
  const ids = {
    kinopoisk: query.ids?.kinopoisk ?? query.kinopoisk,
    imdb: query.ids?.imdb ?? query.imdb,
    shikimori: query.ids?.shikimori ?? query.shikimori,
  };
  const ordered =
    query.type === "anime"
      ? ([
          ["shikimori_id", ids.shikimori],
          ["kinopoisk_id", ids.kinopoisk],
          ["imdb_id", ids.imdb],
        ] as const)
      : ([
          ["kinopoisk_id", ids.kinopoisk],
          ["imdb_id", ids.imdb],
        ] as const);
  return ordered.flatMap(([key, value]) => {
    const normalized = normalizeLookup(key, value);
    return normalized ? [{ key, value: normalized }] : [];
  });
}

function normalizeLookup(key: KodikLookupKey, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (key === "imdb_id") return /^tt\d{5,12}$/u.test(normalized) ? normalized : undefined;
  return /^\d{1,12}$/u.test(normalized) ? normalized : undefined;
}

function parseResult(value: unknown): KodikResult | undefined {
  if (!isRecord(value) || !isRecord(value.translation)) return undefined;
  const id = readString(value.id, 100);
  const type = readString(value.type, 100);
  const link = readString(value.link, MAX_URL_LENGTH);
  const title = readString(value.title, MAX_TITLE_LENGTH);
  const translationTitle = readString(value.translation.title, MAX_TITLE_LENGTH);
  if (!id || !type || !link || !title || !translationTitle) return undefined;

  const originalTitle = readString(value.title_orig, MAX_TITLE_LENGTH);
  const year = readInteger(value.year, 1_800, 3_000);
  const translationId = readIdentifier(value.translation.id);
  const translationType = readString(value.translation.type, 100);
  const quality = readString(value.quality, 200);

  return {
    id,
    type,
    link,
    title,
    ...(originalTitle ? { originalTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    ...readExternalIds(value),
    translation: {
      ...(translationId ? { id: translationId } : {}),
      title: translationTitle,
      ...(translationType ? { type: translationType } : {}),
    },
    ...(quality ? { quality } : {}),
    blockedCountries: readStringArray(value.blocked_countries, 100, 100),
    blockedSeasons: readBlockedSeasons(value.blocked_seasons),
    seasons: readSeasons(value.seasons),
  };
}

function readExternalIds(value: Record<string, unknown>): Partial<KodikResult> {
  const kinopoiskId = readNumericIdentifier(value.kinopoisk_id);
  const imdbId = readString(value.imdb_id, 32);
  const shikimoriId = readNumericIdentifier(value.shikimori_id);
  return {
    ...(kinopoiskId ? { kinopoiskId } : {}),
    ...(imdbId && /^tt\d{5,12}$/u.test(imdbId) ? { imdbId } : {}),
    ...(shikimoriId ? { shikimoriId } : {}),
  };
}

function readSeasons(value: unknown): Record<number, KodikSeason> {
  if (!isRecord(value)) return {};
  const seasons: Record<number, KodikSeason> = {};
  for (const [seasonKey, rawSeason] of Object.entries(value).slice(0, 100)) {
    const seasonNumber = parsePositiveInteger(seasonKey);
    if (seasonNumber === undefined || !isRecord(rawSeason) || !isRecord(rawSeason.episodes))
      continue;
    const episodes: Record<number, string> = {};
    for (const [episodeKey, rawLink] of Object.entries(rawSeason.episodes).slice(0, 2_000)) {
      const episodeNumber = parsePositiveInteger(episodeKey);
      const link = readString(rawLink, MAX_URL_LENGTH);
      if (episodeNumber !== undefined && link) episodes[episodeNumber] = link;
    }
    const link = readString(rawSeason.link, MAX_URL_LENGTH);
    seasons[seasonNumber] = { ...(link ? { link } : {}), episodes };
  }
  return seasons;
}

function readBlockedSeasons(value: unknown): Set<number> {
  const values = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value)
          .filter(([, blocked]) => Boolean(blocked))
          .map(([key]) => key)
      : [];
  return new Set(
    values.flatMap((entry) => {
      const parsed = parsePositiveInteger(String(entry));
      return parsed === undefined ? [] : [parsed];
    }),
  );
}

function readStringArray(value: unknown, limit: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value
        .slice(0, limit)
        .flatMap((entry) => (readString(entry, maxLength) ? [readString(entry, maxLength)!] : []))
    : [];
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return readString(value, 100);
}

function readNumericIdentifier(value: unknown): string | undefined {
  const normalized = readIdentifier(value);
  return normalized && /^\d{1,12}$/u.test(normalized) ? normalized : undefined;
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d{0,5}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid Kodik response.`,
    retryable: false,
  });
}
