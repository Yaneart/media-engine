import {
  ProviderError,
  type ProviderContext,
  type TorrentDiscoveryQuery,
} from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import { createTorrentReleaseSearchTerm } from "../shared/torrent-release-matching.js";
import type { BitsearchTorrentConfig } from "./config.js";

const INFO_HASH = /^[a-f\d]{40}$/iu;
const RESULT_ID = /^[a-f\d]{24}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export interface BitsearchTorrentRelease {
  id: string;
  infoHash: string;
  title: string;
  sizeBytes?: number;
  category: number;
  subCategory?: number;
  seeders?: number;
  leechers?: number;
  verified: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export async function searchBitsearchTorrents(
  config: BitsearchTorrentConfig,
  query: TorrentDiscoveryQuery,
  context: ProviderContext,
): Promise<BitsearchTorrentRelease[]> {
  const searchTerm = createBitsearchSearchTerm(query);
  const url = createBitsearchTorrentSearchUrl(config, query, searchTerm);
  config.quotaGate.assertAvailable(config.name);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: async (input, init) => {
      config.quotaGate.assertAvailable(config.name);
      const response = await config.fetch(input, init);
      config.quotaGate.observe(response);
      return response;
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

  return parseBitsearchTorrentResponse(config.name, payload, searchTerm, config.resultLimit);
}

export function createBitsearchSearchTerm(query: TorrentDiscoveryQuery): string {
  return createTorrentReleaseSearchTerm(query);
}

export function createBitsearchTorrentSearchUrl(
  config: Pick<BitsearchTorrentConfig, "baseUrl" | "searchPath" | "resultLimit">,
  query: TorrentDiscoveryQuery,
  searchTerm = createBitsearchSearchTerm(query),
): URL {
  const url = new URL(config.searchPath, `${config.baseUrl}/`);
  url.searchParams.set("q", searchTerm);
  url.searchParams.set("category", String(mapQueryCategory(query.type)));
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("order", "desc");
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", String(config.resultLimit));
  return url;
}

export function parseBitsearchTorrentResponse(
  provider: string,
  value: unknown,
  expectedQuery: string,
  resultLimit: number,
): BitsearchTorrentRelease[] {
  if (!isRecord(value) || value.success !== true || !isRecord(value.pagination)) {
    throw invalidResponse(provider);
  }

  const query = readString(value.query, 1_000);
  const took = readNumber(value.took, 0, Number.MAX_SAFE_INTEGER);
  const page = readInteger(value.pagination.page, 1, Number.MAX_SAFE_INTEGER);
  const perPage = readInteger(value.pagination.perPage, 1, 100);
  const total = readInteger(value.pagination.total, 0, Number.MAX_SAFE_INTEGER);
  const totalPages = readInteger(value.pagination.totalPages, 0, Number.MAX_SAFE_INTEGER);
  const hasNext = value.pagination.hasNext;
  const hasPrev = value.pagination.hasPrev;
  const rawResults = value.results;

  if (
    query !== expectedQuery ||
    took === undefined ||
    page !== 1 ||
    perPage !== resultLimit ||
    total === undefined ||
    totalPages === undefined ||
    typeof hasNext !== "boolean" ||
    typeof hasPrev !== "boolean" ||
    !Array.isArray(rawResults) ||
    rawResults.length > resultLimit ||
    rawResults.length > perPage ||
    hasPrev
  ) {
    throw invalidResponse(provider);
  }

  if (total === 0 && (rawResults.length > 0 || totalPages !== 0 || hasNext)) {
    throw invalidResponse(provider);
  }
  if (total > 0 && (rawResults.length === 0 || totalPages === 0)) {
    throw invalidResponse(provider);
  }

  const releases = rawResults.flatMap((entry) => {
    const release = parseRelease(entry);
    return release ? [release] : [];
  });

  if (rawResults.length > 0 && releases.length === 0) throw invalidResponse(provider);
  return releases;
}

function parseRelease(value: unknown): BitsearchTorrentRelease | undefined {
  if (!isRecord(value)) return undefined;

  const id = readString(value.id, 100);
  const infoHash = readString(value.infohash, 40);
  const title = readString(value.title, 1_000);
  const sizeBytes = readOptionalInteger(value.size, 0, Number.MAX_SAFE_INTEGER);
  const category = readInteger(value.category, 1, 10);
  const subCategory = readOptionalInteger(value.subCategory, 1, 100);
  const seeders = readOptionalInteger(value.seeders, 0, Number.MAX_SAFE_INTEGER);
  const leechers = readOptionalInteger(value.leechers, 0, Number.MAX_SAFE_INTEGER);
  const downloads = readOptionalInteger(value.downloads, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = readOptionalDate(value.createdAt);
  const updatedAt = readOptionalDate(value.updatedAt);

  if (
    !id ||
    !RESULT_ID.test(id) ||
    !infoHash ||
    !INFO_HASH.test(infoHash) ||
    !title ||
    sizeBytes === false ||
    category === undefined ||
    subCategory === false ||
    seeders === false ||
    leechers === false ||
    downloads === false ||
    typeof value.verified !== "boolean" ||
    createdAt === false ||
    updatedAt === false
  ) {
    return undefined;
  }

  return {
    id: id.toLowerCase(),
    infoHash: infoHash.toUpperCase(),
    title,
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    category,
    ...(subCategory !== undefined ? { subCategory } : {}),
    ...(seeders !== undefined ? { seeders } : {}),
    ...(leechers !== undefined ? { leechers } : {}),
    verified: value.verified,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function mapQueryCategory(type: TorrentDiscoveryQuery["type"]): number {
  if (type === "movie") return 2;
  if (type === "series") return 3;
  return 4;
}

function readString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && !CONTROL_CHARACTERS.test(value)
    ? value.trim().slice(0, maxLength) || undefined
    : undefined;
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function readNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function readOptionalInteger(value: unknown, min: number, max: number): number | undefined | false {
  if (value === null || value === undefined) return undefined;
  return readInteger(value, min, max) ?? false;
}

function readOptionalDate(value: unknown): string | undefined | false {
  if (value === null || value === undefined) return undefined;

  const raw = readString(value, 40);
  if (!raw) return false;

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;

  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  return year >= 1_800 && year <= 3_000 ? date.toISOString() : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid Bitsearch response.`,
    retryable: false,
  });
}
