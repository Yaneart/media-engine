import { ProviderError, type ProviderContext } from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import type { RutubeStreamingConfig } from "./config.js";

const MAX_TITLE_LENGTH = 500;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const RUTUBE_VIDEO_ID = /^[a-f0-9]{32}$/iu;

export interface RutubeMovieCandidate {
  id: string;
  title: string;
  durationSeconds: number;
  categoryId: number;
  hidden: boolean;
  deleted: boolean;
  adult: boolean;
  locked: boolean;
  audio: boolean;
  paid: boolean;
  livestream: boolean;
}

export async function searchRutubeMovies(
  config: RutubeStreamingConfig,
  title: string,
  year: number,
  context: ProviderContext,
): Promise<RutubeMovieCandidate[]> {
  const url = createRutubeSearchUrl(config, title, year);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxResponseBytes: config.maxResponseBytes,
    init: {
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
      },
    },
  });

  return parseRutubeSearchResponse(config.name, payload, config.searchResultLimit);
}

export function createRutubeSearchUrl(
  config: Pick<RutubeStreamingConfig, "baseUrl" | "searchResultLimit">,
  title: string,
  year: number,
): URL {
  const url = new URL("/api/search/video/", `${config.baseUrl}/`);
  url.searchParams.set("content_type", "video");
  url.searchParams.set("duration", "movie");
  url.searchParams.set("limit", String(config.searchResultLimit));
  url.searchParams.set("query", `${title.trim()} ${year}`);
  return url;
}

export function parseRutubeSearchResponse(
  provider: string,
  value: unknown,
  limit: number,
): RutubeMovieCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.results)) throw invalidResponse(provider);

  const candidates = value.results.slice(0, limit).flatMap((entry) => {
    const candidate = parseCandidate(entry);
    return candidate ? [candidate] : [];
  });

  if (value.results.length > 0 && candidates.length === 0) throw invalidResponse(provider);
  return candidates;
}

function parseCandidate(value: unknown): RutubeMovieCandidate | undefined {
  if (!isRecord(value) || !isRecord(value.category)) return undefined;

  const id = readVideoId(value.id);
  const title = readString(value.title, MAX_TITLE_LENGTH);
  const durationSeconds = readInteger(value.duration, 0, MAX_DURATION_SECONDS);
  const categoryId = readInteger(value.category.id, 0, 10_000);
  const flags = [
    value.is_hidden,
    value.is_deleted,
    value.is_adult,
    value.is_locked,
    value.is_audio,
    value.is_paid,
    value.is_livestream,
  ];

  if (
    !id ||
    !title ||
    durationSeconds === undefined ||
    categoryId === undefined ||
    flags.some((flag) => typeof flag !== "boolean")
  ) {
    return undefined;
  }

  const [hidden, deleted, adult, locked, audio, paid, livestream] = flags as boolean[];
  return {
    id,
    title,
    durationSeconds,
    categoryId,
    hidden: hidden!,
    deleted: deleted!,
    adult: adult!,
    locked: locked!,
    audio: audio!,
    paid: paid!,
    livestream: livestream!,
  };
}

function readVideoId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toLowerCase();
  return RUTUBE_VIDEO_ID.test(id) ? id : undefined;
}

function readString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid Rutube search response.`,
    retryable: false,
  });
}
