import {
  ProviderError,
  type ProviderContext,
  type TorrentDiscoveryQuery,
} from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl } from "../shared/index.js";
import type { JacRedTorrentConfig } from "./config.js";

const INFO_HASH = /^[a-f\d]{40}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_MAGNET_LENGTH = 16_384;

export interface JacRedTorrentRelease {
  title: string;
  name: string;
  originalName?: string;
  year: number;
  categories: string[];
  seasons: number[];
  quality?: number;
  qualityLabel?: string;
  videoType?: string;
  sizeBytes?: number;
  seeders?: number;
  peers?: number;
  createdAt?: string;
  infoHash: string;
  sourceUrl?: string;
}

export async function searchJacRedTorrents(
  config: JacRedTorrentConfig,
  query: TorrentDiscoveryQuery,
  context: ProviderContext,
): Promise<JacRedTorrentRelease[]> {
  const url = createJacRedTorrentSearchUrl(config, query);
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

  return parseJacRedTorrentResponse(config.name, payload, config.resultLimit);
}

export function createJacRedTorrentSearchUrl(
  config: Pick<JacRedTorrentConfig, "baseUrl" | "searchPath" | "resultLimit">,
  query: TorrentDiscoveryQuery,
): URL {
  const url = new URL(config.searchPath, `${config.baseUrl}/`);
  url.searchParams.set("query", query.title!.trim());
  url.searchParams.set("year", String(query.year));
  url.searchParams.set("exact", "true");
  url.searchParams.set("sort", "sid");
  url.searchParams.set("category", mapQueryCategory(query.type));
  url.searchParams.set("limit", String(config.resultLimit));

  if (query.seasonNumber !== undefined) {
    url.searchParams.set("season", String(query.seasonNumber));
  }

  return url;
}

export function parseJacRedTorrentResponse(
  provider: string,
  value: unknown,
  resultLimit: number,
): JacRedTorrentRelease[] {
  if (!isRecord(value)) throw invalidResponse(provider);

  const query = readString(value.query, 500);
  const total = readInteger(value.total, 0, Number.MAX_SAFE_INTEGER);
  const loaded = readInteger(value.loaded, 0, Number.MAX_SAFE_INTEGER);
  const limit = readInteger(value.limit, 1, 10_000);
  const rawResults = value.results;

  if (
    !query ||
    total === undefined ||
    loaded === undefined ||
    limit === undefined ||
    typeof value.open !== "boolean" ||
    !Array.isArray(rawResults)
  ) {
    throw invalidResponse(provider);
  }

  if (!value.open) {
    throw new ProviderError({
      provider,
      code: "PROVIDER_UNAVAILABLE",
      message: `Provider "${provider}" public JacRed search is closed.`,
      retryable: true,
    });
  }

  if (total > 0 && rawResults.length === 0) throw invalidResponse(provider);

  let validRecords = 0;
  const releases: JacRedTorrentRelease[] = [];

  for (const rawResult of rawResults.slice(0, resultLimit)) {
    const parsed = parseRelease(rawResult);

    if (parsed !== false) {
      validRecords += 1;
      if (parsed) releases.push(parsed);
    }
  }

  if (rawResults.length > 0 && validRecords === 0) throw invalidResponse(provider);
  return releases;
}

function parseRelease(value: unknown): JacRedTorrentRelease | undefined | false {
  if (!isRecord(value)) return false;

  const id = readString(value.id, 100);
  const title = readString(value.title, 2_000);
  const tracker = readString(value.tracker, 100);
  const name = readString(value.name, 500);
  const originalName = readOptionalString(value.original_name, 500);
  const year = readInteger(value.year, 1_800, 3_000);
  const categories = readStringArray(value.categories, 20, 80);
  const seasons = readIntegerArray(value.seasons, 100, 0, 10_000);
  const quality = readOptionalQuality(value.quality);
  const qualityLabel = readOptionalString(value.quality_label, 80);
  const videoType = readOptionalString(value.video_type, 80);
  const voices = readOptionalStringArray(value.voices, 50, 120);
  const sizeBytes = readOptionalInteger(value.size, 0, Number.MAX_SAFE_INTEGER);
  const seeders = readOptionalInteger(value.seeders, 0, Number.MAX_SAFE_INTEGER);
  const peers = readOptionalInteger(value.peers, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = readOptionalDate(value.created_at);
  const updatedAt = readOptionalDate(value.updated_at);
  const sourceUrl = readOptionalUrl(value.source_url);

  if (
    !id ||
    !title ||
    !tracker ||
    !name ||
    originalName === false ||
    year === undefined ||
    categories === false ||
    seasons === false ||
    quality === false ||
    qualityLabel === false ||
    videoType === false ||
    voices === false ||
    sizeBytes === false ||
    seeders === false ||
    peers === false ||
    createdAt === false ||
    updatedAt === false ||
    sourceUrl === false ||
    typeof value.magnet_available !== "boolean"
  ) {
    return false;
  }

  if (!value.magnet_available) return undefined;

  const magnet = readString(value.magnet, MAX_MAGNET_LENGTH);
  const infoHash = magnet ? extractMagnetInfoHash(magnet) : undefined;
  if (!infoHash) return false;

  return {
    title,
    name,
    ...(originalName ? { originalName } : {}),
    year,
    categories,
    seasons,
    ...(quality !== undefined ? { quality } : {}),
    ...(qualityLabel ? { qualityLabel } : {}),
    ...(videoType ? { videoType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(seeders !== undefined ? { seeders } : {}),
    ...(peers !== undefined ? { peers } : {}),
    ...(createdAt ? { createdAt } : {}),
    infoHash,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function extractMagnetInfoHash(value: string): string | undefined {
  if (CONTROL_CHARACTERS.test(value)) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "magnet:") return undefined;

    const hashes = url.searchParams
      .getAll("xt")
      .flatMap((entry) => {
        const match = /^urn:btih:([a-f\d]{40})$/iu.exec(entry);
        return match?.[1] ? [match[1].toUpperCase()] : [];
      })
      .filter((hash, index, values) => values.indexOf(hash) === index);

    return hashes.length === 1 && INFO_HASH.test(hashes[0]!) ? hashes[0] : undefined;
  } catch {
    return undefined;
  }
}

function mapQueryCategory(type: TorrentDiscoveryQuery["type"]): string {
  if (type === "movie") return "movie";
  if (type === "series") return "serial";
  return "anime";
}

function readString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && !CONTROL_CHARACTERS.test(value)
    ? value.trim().slice(0, maxLength) || undefined
    : undefined;
}

function readOptionalString(value: unknown, maxLength: number): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return false;
  return value.trim().slice(0, maxLength) || undefined;
}

function readStringArray(value: unknown, maxItems: number, maxLength: number): string[] | false {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  const strings = value.map((entry) => readString(entry, maxLength));
  return strings.some((entry) => entry === undefined) ? false : (strings as string[]);
}

function readOptionalStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | false {
  if (value === null || value === undefined) return [];
  return readStringArray(value, maxItems, maxLength);
}

function readIntegerArray(
  value: unknown,
  maxItems: number,
  min: number,
  max: number,
): number[] | false {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  const integers = value.map((entry) => readInteger(entry, min, max));
  return integers.some((entry) => entry === undefined) ? false : (integers as number[]);
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

function readOptionalQuality(value: unknown): number | undefined | false {
  const quality = readOptionalInteger(value, 0, 4_320);
  return quality === 0 ? undefined : quality;
}

function readOptionalDate(value: unknown): string | undefined | false {
  const raw = readOptionalString(value, 40);
  if (raw === false || raw === undefined) return raw;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(raw)) return false;

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;

  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  return year >= 1_800 && year <= 3_000 ? date.toISOString() : false;
}

function readOptionalUrl(value: unknown): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return false;
  return normalizeProviderOutputUrl(value) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid JacRed response.`,
    retryable: false,
  });
}
