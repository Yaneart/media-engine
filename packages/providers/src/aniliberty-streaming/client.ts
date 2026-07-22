import { ProviderError, type ProviderContext } from "@media-engine/core";
import { fetchJson, getProviderHttpStatus } from "../shared/index.js";
import type { AniLibertyStreamingConfig } from "./config.js";

const SEARCH_INCLUDE = [
  "id",
  "year",
  "name",
  "alias",
  "is_blocked_by_geo",
  "is_blocked_by_copyrights",
].join(",");
const RELEASE_INCLUDE = [
  SEARCH_INCLUDE,
  "episodes.id",
  "episodes.name",
  "episodes.ordinal",
  "episodes.hls_480",
  "episodes.hls_720",
  "episodes.hls_1080",
].join(",");

export interface AniLibertyReleaseName {
  main?: string;
  english?: string;
  alternative?: string;
}

export interface AniLibertyReleaseSummary {
  id: number;
  year: number;
  name: AniLibertyReleaseName;
  alias?: string;
  blockedByGeo: boolean;
  blockedByCopyrights: boolean;
}

export interface AniLibertyEpisode {
  id: string;
  name?: string;
  ordinal: number;
  hls480?: string;
  hls720?: string;
  hls1080?: string;
}

export interface AniLibertyRelease extends AniLibertyReleaseSummary {
  episodes: AniLibertyEpisode[];
}

export async function searchAniLibertyReleases(
  config: AniLibertyStreamingConfig,
  title: string,
  context: ProviderContext,
): Promise<AniLibertyReleaseSummary[]> {
  const url = new URL("/api/v1/app/search/releases", `${config.baseUrl}/`);
  url.searchParams.set("query", title);
  url.searchParams.set("include", SEARCH_INCLUDE);

  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxResponseBytes: config.maxResponseBytes,
    init: { headers: createHeaders(config) },
  });

  return parseAniLibertySearchResponse(config.name, payload, config.searchResultLimit);
}

export async function loadAniLibertyRelease(
  config: AniLibertyStreamingConfig,
  releaseId: number,
  context: ProviderContext,
): Promise<{ release: AniLibertyRelease; sourceUrl: string } | null> {
  const sourceUrl = new URL(`/api/v1/anime/releases/${releaseId}`, `${config.baseUrl}/`);
  const requestUrl = new URL(sourceUrl);
  requestUrl.searchParams.set("include", RELEASE_INCLUDE);

  try {
    const payload = await fetchJson<unknown>({
      provider: config.name,
      url: requestUrl,
      context,
      fetch: config.fetch,
      rateLimitGate: config.rateLimitGate,
      maxResponseBytes: config.maxResponseBytes,
      init: { headers: createHeaders(config) },
    });

    return {
      release: parseAniLibertyRelease(config.name, payload, config.episodeLimit),
      sourceUrl: sourceUrl.href,
    };
  } catch (error) {
    if (getProviderHttpStatus(error) === 404) return null;
    throw error;
  }
}

export function parseAniLibertySearchResponse(
  provider: string,
  value: unknown,
  limit: number,
): AniLibertyReleaseSummary[] {
  if (!Array.isArray(value)) {
    throw invalidResponse(provider);
  }

  const releases = value.slice(0, limit).flatMap((entry) => {
    const release = parseReleaseSummary(entry);
    return release ? [release] : [];
  });

  if (value.length > 0 && releases.length === 0) {
    throw invalidResponse(provider);
  }

  return releases;
}

export function parseAniLibertyRelease(
  provider: string,
  value: unknown,
  episodeLimit: number,
): AniLibertyRelease {
  const summary = parseReleaseSummary(value);

  if (!summary || !isRecord(value) || !Array.isArray(value.episodes)) {
    throw invalidResponse(provider);
  }

  const episodes = value.episodes.slice(0, episodeLimit).flatMap((entry) => {
    const episode = parseEpisode(entry);
    return episode ? [episode] : [];
  });

  if (value.episodes.length > 0 && episodes.length === 0) {
    throw invalidResponse(provider);
  }

  return { ...summary, episodes };
}

function parseReleaseSummary(value: unknown): AniLibertyReleaseSummary | undefined {
  if (!isRecord(value) || !isRecord(value.name)) return undefined;

  const id = readInteger(value.id, 1, Number.MAX_SAFE_INTEGER);
  const year = readInteger(value.year, 1_800, 3_000);
  const main = readNullableString(value.name.main, 500);
  const english = readNullableString(value.name.english, 500);
  const alternative = readNullableString(value.name.alternative, 2_000);
  const alias = readNullableString(value.alias, 500);
  const blockedByGeo = readOptionalBoolean(value.is_blocked_by_geo);
  const blockedByCopyrights = readOptionalBoolean(value.is_blocked_by_copyrights);

  if (
    id === undefined ||
    year === undefined ||
    main === false ||
    english === false ||
    alternative === false ||
    alias === false ||
    blockedByGeo === undefined ||
    blockedByCopyrights === undefined ||
    (!main && !english)
  ) {
    return undefined;
  }

  return {
    id,
    year,
    name: {
      ...(main ? { main } : {}),
      ...(english ? { english } : {}),
      ...(alternative ? { alternative } : {}),
    },
    ...(alias ? { alias } : {}),
    blockedByGeo,
    blockedByCopyrights,
  };
}

function parseEpisode(value: unknown): AniLibertyEpisode | undefined {
  if (!isRecord(value)) return undefined;

  const id = readRequiredString(value.id, 200);
  const ordinal = readFiniteNumber(value.ordinal, 0, 100_000);
  const name = readNullableString(value.name, 500);
  const hls480 = readNullableString(value.hls_480, 8_192);
  const hls720 = readNullableString(value.hls_720, 8_192);
  const hls1080 = readNullableString(value.hls_1080, 8_192);

  if (
    !id ||
    ordinal === undefined ||
    name === false ||
    hls480 === false ||
    hls720 === false ||
    hls1080 === false
  ) {
    return undefined;
  }

  return {
    id,
    ordinal,
    ...(name ? { name } : {}),
    ...(hls480 ? { hls480 } : {}),
    ...(hls720 ? { hls720 } : {}),
    ...(hls1080 ? { hls1080 } : {}),
  };
}

function createHeaders(config: AniLibertyStreamingConfig): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
  };
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function readFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function readRequiredString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function readNullableString(value: unknown, maxLength: number): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : false;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return false;
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid AniLiberty response.`,
    retryable: false,
  });
}
