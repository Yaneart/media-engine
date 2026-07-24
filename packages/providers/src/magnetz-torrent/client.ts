import {
  ProviderError,
  type ProviderContext,
  type TorrentDiscoveryQuery,
} from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl } from "../shared/index.js";
import { createTorrentReleaseSearchTerm } from "../shared/torrent-release-matching.js";
import type { MagnetzTorrentConfig } from "./config.js";

const INFO_HASH = /^[a-f\d]{40}$/iu;
const SQID = /^[a-z\d]{2,64}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_MAGNET_LENGTH = 16_384;
const UPSTREAM_PAGE_SIZE = 25;
const UPSTREAM_MAX_RESULTS = 100;

export interface MagnetzTorrentRelease {
  sqid: string;
  infoHash: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  verified: boolean;
  createdAt: string;
  sourceUrl: string;
}

export async function searchMagnetzTorrents(
  config: MagnetzTorrentConfig,
  query: TorrentDiscoveryQuery,
  context: ProviderContext,
): Promise<MagnetzTorrentRelease[]> {
  const searchTerm = createTorrentReleaseSearchTerm(query);
  const url = createMagnetzTorrentSearchUrl(config, searchTerm);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: async (input, init) => {
      await config.requestGate.wait(init?.signal ?? undefined);
      return config.fetch(input, init);
    },
    rateLimitGate: config.rateLimitGate,
    maxResponseBytes: config.maxResponseBytes,
    init: {
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
      },
    },
  });

  return parseMagnetzTorrentResponse(config.name, payload, searchTerm, config, config.resultLimit);
}

export function createMagnetzTorrentSearchUrl(
  config: Pick<MagnetzTorrentConfig, "baseUrl" | "searchPath">,
  searchTerm: string,
): URL {
  const url = new URL(config.searchPath, `${config.baseUrl}/`);
  url.searchParams.set("query", searchTerm);
  url.searchParams.set("page", "1");
  return url;
}

export function parseMagnetzTorrentResponse(
  provider: string,
  value: unknown,
  expectedQuery: string,
  config: Pick<MagnetzTorrentConfig, "baseUrl" | "searchPath">,
  resultLimit: number,
): MagnetzTorrentRelease[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    !isRecord(value.links) ||
    !isRecord(value.meta)
  ) {
    throw invalidResponse(provider);
  }

  const query = readString(value.meta.query, 255);
  const currentPage = readInteger(value.meta.current_page, 1, 4);
  const lastPage = readInteger(value.meta.last_page, 1, 4);
  const perPage = readInteger(value.meta.per_page, UPSTREAM_PAGE_SIZE, UPSTREAM_PAGE_SIZE);
  const total = readInteger(value.meta.total, 0, UPSTREAM_MAX_RESULTS);
  const from = readOptionalInteger(value.meta.from, 1, UPSTREAM_MAX_RESULTS);
  const to = readOptionalInteger(value.meta.to, 1, UPSTREAM_MAX_RESULTS);
  const first = readPaginationLink(value.links.first, config);
  const last = readPaginationLink(value.links.last, config);
  const previous = readPaginationLink(value.links.prev, config);
  const next = readPaginationLink(value.links.next, config);
  const rawResults = value.data;

  if (
    query !== expectedQuery ||
    currentPage !== 1 ||
    lastPage === undefined ||
    perPage === undefined ||
    total === undefined ||
    from === false ||
    to === false ||
    first === false ||
    !first ||
    last === false ||
    !last ||
    previous !== undefined ||
    next === false ||
    rawResults.length > UPSTREAM_PAGE_SIZE
  ) {
    throw invalidResponse(provider);
  }

  if (
    (total === 0 &&
      (rawResults.length > 0 ||
        from !== undefined ||
        to !== undefined ||
        lastPage !== 1 ||
        next)) ||
    (total > 0 &&
      (rawResults.length === 0 || from !== 1 || to !== rawResults.length || lastPage < 1)) ||
    (lastPage === 1 && next) ||
    (lastPage > 1 && !next)
  ) {
    throw invalidResponse(provider);
  }

  const releases = rawResults.slice(0, resultLimit).flatMap((entry) => {
    const release = parseRelease(entry, config.baseUrl);
    return release ? [release] : [];
  });

  if (rawResults.length > 0 && releases.length === 0) throw invalidResponse(provider);
  return releases;
}

function parseRelease(value: unknown, baseUrl: string): MagnetzTorrentRelease | undefined {
  if (!isRecord(value)) return undefined;

  const sqid = readString(value.sqid, 64);
  const infoHash = readString(value.info_hash, 40);
  const title = readString(value.name, 1_000);
  const sizeBytes = readInteger(value.size, 0, Number.MAX_SAFE_INTEGER);
  const humanSize = readString(value.human_size, 80);
  const score = readNumber(value.score, 0, 100);
  const health = readNumber(value.health, 0, 100);
  const largestFile = readOptionalString(value.largest_file, 2_000);
  const magnetHash = readMagnetInfoHash(value.magnet_link);
  const seeders = readInteger(value.seeders, 0, Number.MAX_SAFE_INTEGER);
  const leechers = readInteger(value.leechers, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = readDate(value.created_at);
  const sourceUrl = sqid ? readSourceUrl(value.web_url, baseUrl, sqid) : false;

  if (
    !sqid ||
    !SQID.test(sqid) ||
    !infoHash ||
    !INFO_HASH.test(infoHash) ||
    !title ||
    sizeBytes === undefined ||
    !humanSize ||
    score === undefined ||
    health === undefined ||
    largestFile === false ||
    !magnetHash ||
    magnetHash !== infoHash.toUpperCase() ||
    seeders === undefined ||
    leechers === undefined ||
    typeof value.is_verified !== "boolean" ||
    !createdAt ||
    !sourceUrl
  ) {
    return undefined;
  }

  return {
    sqid,
    infoHash: infoHash.toUpperCase(),
    title,
    sizeBytes,
    seeders,
    leechers,
    verified: value.is_verified,
    createdAt,
    sourceUrl,
  };
}

function readMagnetInfoHash(value: unknown): string | undefined {
  const raw = readString(value, MAX_MAGNET_LENGTH);
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== "magnet:") return undefined;

    const hashes = url.searchParams
      .getAll("xt")
      .flatMap((entry) => {
        const match = /^urn:btih:([a-f\d]{40})$/iu.exec(entry);
        return match?.[1] ? [match[1].toUpperCase()] : [];
      })
      .filter((hash, index, values) => values.indexOf(hash) === index);

    return hashes.length === 1 ? hashes[0] : undefined;
  } catch {
    return undefined;
  }
}

function readSourceUrl(value: unknown, baseUrl: string, sqid: string): string | false {
  if (typeof value !== "string") return false;

  const normalized = normalizeProviderOutputUrl(value);
  if (!normalized) return false;

  const url = new URL(normalized);
  const base = new URL(baseUrl);
  return url.origin === base.origin &&
    (url.pathname === `/${sqid}` || url.pathname === `/magnet/${sqid}`)
    ? url.href
    : false;
}

function readPaginationLink(
  value: unknown,
  config: Pick<MagnetzTorrentConfig, "baseUrl" | "searchPath">,
): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return false;

  try {
    const url = new URL(value, `${config.baseUrl}/`);
    const base = new URL(config.baseUrl);
    return url.origin === base.origin && url.pathname === config.searchPath ? url.href : false;
  } catch {
    return false;
  }
}

function readString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength && !CONTROL_CHARACTERS.test(value)
    ? value.trim() || undefined
    : undefined;
}

function readOptionalString(value: unknown, maxLength: number): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  return readString(value, maxLength) ?? false;
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

function readNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function readDate(value: unknown): string | undefined {
  const raw = readString(value, 40);
  if (!raw) return undefined;

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;

  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  return year >= 1_800 && year <= 3_000 ? date.toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid Magnetz response.`,
    retryable: false,
  });
}
