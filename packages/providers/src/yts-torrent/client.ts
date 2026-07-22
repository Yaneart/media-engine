import { ProviderError, type ProviderContext } from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl } from "../shared/index.js";
import type { YtsTorrentConfig } from "./config.js";

const IMDB_ID = /^tt\d{7,10}$/u;
const INFO_HASH = /^[a-f\d]{40}$/iu;

export interface YtsTorrentRelease {
  hash: string;
  torrentUrl?: string;
  quality: string;
  sourceType?: string;
  videoCodec?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  uploadedAt?: string;
}

export interface YtsTorrentMovie {
  id: number;
  imdb: string;
  title: string;
  englishTitle?: string;
  year: number;
  sourceUrl?: string;
  torrents: YtsTorrentRelease[];
}

export async function searchYtsTorrentMovies(
  config: YtsTorrentConfig,
  queryTerm: string,
  context: ProviderContext,
): Promise<YtsTorrentMovie[]> {
  const url = createYtsTorrentSearchUrl(config, queryTerm);
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

  return parseYtsTorrentResponse(config.name, payload, config.resultLimit);
}

export function createYtsTorrentSearchUrl(
  config: Pick<YtsTorrentConfig, "baseUrl" | "resultLimit">,
  queryTerm: string,
): URL {
  const url = new URL("/api/v2/list_movies.json", `${config.baseUrl}/`);
  url.searchParams.set("query_term", queryTerm.trim());
  url.searchParams.set("limit", String(config.resultLimit));
  url.searchParams.set("sort_by", "seeds");
  url.searchParams.set("order_by", "desc");
  return url;
}

export function parseYtsTorrentResponse(
  provider: string,
  value: unknown,
  resultLimit: number,
): YtsTorrentMovie[] {
  if (!isRecord(value) || value.status !== "ok" || !isRecord(value.data)) {
    throw invalidResponse(provider);
  }

  const movieCount = readInteger(value.data.movie_count, 0, Number.MAX_SAFE_INTEGER);
  const rawMovies = value.data.movies;

  if (movieCount === undefined || (rawMovies !== undefined && !Array.isArray(rawMovies))) {
    throw invalidResponse(provider);
  }

  if (movieCount === 0 && rawMovies === undefined) return [];
  if (!Array.isArray(rawMovies)) throw invalidResponse(provider);
  if (movieCount > 0 && rawMovies.length === 0) throw invalidResponse(provider);

  const movies = rawMovies.slice(0, resultLimit).flatMap((entry) => {
    const movie = parseMovie(entry);
    return movie ? [movie] : [];
  });

  if (rawMovies.length > 0 && movies.length === 0) {
    throw invalidResponse(provider);
  }

  return movies;
}

function parseMovie(value: unknown): YtsTorrentMovie | undefined {
  if (!isRecord(value) || !Array.isArray(value.torrents)) return undefined;

  const id = readInteger(value.id, 1, Number.MAX_SAFE_INTEGER);
  const imdb = readString(value.imdb_code, 20);
  const title = readString(value.title, 500);
  const englishTitle = readOptionalString(value.title_english, 500);
  const year = readInteger(value.year, 1_800, 3_000);
  const sourceUrl = readOptionalUrl(value.url);

  if (
    id === undefined ||
    !imdb ||
    !IMDB_ID.test(imdb) ||
    !title ||
    englishTitle === false ||
    year === undefined ||
    sourceUrl === false
  ) {
    return undefined;
  }

  const torrents = value.torrents.flatMap((entry) => {
    const torrent = parseTorrent(entry);
    return torrent ? [torrent] : [];
  });

  if (value.torrents.length > 0 && torrents.length === 0) return undefined;

  return {
    id,
    imdb: imdb.toLowerCase(),
    title,
    ...(englishTitle && englishTitle !== title ? { englishTitle } : {}),
    year,
    ...(sourceUrl ? { sourceUrl } : {}),
    torrents,
  };
}

function parseTorrent(value: unknown): YtsTorrentRelease | undefined {
  if (!isRecord(value)) return undefined;

  const hash = readString(value.hash, 40);
  const torrentUrl = readOptionalUrl(value.url);
  const quality = readString(value.quality, 40);
  const sourceType = readOptionalString(value.type, 40);
  const videoCodec = readOptionalString(value.video_codec, 40);
  const sizeBytes = readOptionalInteger(value.size_bytes, 0, Number.MAX_SAFE_INTEGER);
  const seeders = readOptionalInteger(value.seeds, 0, Number.MAX_SAFE_INTEGER);
  const leechers = readOptionalInteger(value.peers, 0, Number.MAX_SAFE_INTEGER);
  const uploadedUnix = readOptionalInteger(value.date_uploaded_unix, 0, 32_503_680_000);

  if (
    !hash ||
    !INFO_HASH.test(hash) ||
    !quality ||
    torrentUrl === false ||
    sourceType === false ||
    videoCodec === false ||
    sizeBytes === false ||
    seeders === false ||
    leechers === false ||
    uploadedUnix === false
  ) {
    return undefined;
  }

  return {
    hash: hash.toUpperCase(),
    ...(torrentUrl ? { torrentUrl } : {}),
    quality,
    ...(sourceType ? { sourceType } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(seeders !== undefined ? { seeders } : {}),
    ...(leechers !== undefined ? { leechers } : {}),
    ...(uploadedUnix !== undefined
      ? { uploadedAt: new Date(uploadedUnix * 1_000).toISOString() }
      : {}),
  };
}

function readString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function readOptionalString(value: unknown, maxLength: number): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value.trim().slice(0, maxLength) || undefined : false;
}

function readOptionalUrl(value: unknown): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return false;
  return normalizeProviderOutputUrl(value) ?? false;
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function readOptionalInteger(value: unknown, min: number, max: number): number | undefined | false {
  if (value === null || value === undefined) return undefined;
  return readInteger(value, min, max) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid YTS response.`,
    retryable: false,
  });
}
