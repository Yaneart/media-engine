import type { TorrentProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";
import { MagnetzRequestGate } from "./request-gate.js";

const DEFAULT_PROVIDER_NAME = "magnetz-torrent";
const DEFAULT_BASE_URL = "https://magnetz.eu";
const DEFAULT_SEARCH_PATH = "/api/magnets/search";
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_RESULT_LIMIT = 25;
const DEFAULT_REQUEST_INTERVAL_MS = 1_000;

export interface MagnetzTorrentProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  searchPath?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  resultLimit?: number;
  requestIntervalMs?: number;
  userAgent?: string;
}

export interface MagnetzTorrentConfig {
  name: string;
  baseUrl: string;
  searchPath: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  requestGate: MagnetzRequestGate;
  maxResponseBytes: number;
  resultLimit: number;
  userAgent: string;
}

export function createMagnetzTorrentConfig(
  options: MagnetzTorrentProviderOptions,
): MagnetzTorrentConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);
  const requestIntervalMs = resolveBoundedIntegerOption(
    options.requestIntervalMs,
    DEFAULT_REQUEST_INTERVAL_MS,
    "Magnetz torrent requestIntervalMs",
    0,
    5_000,
  );

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    searchPath: normalizeSearchPath(options.searchPath ?? DEFAULT_SEARCH_PATH),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 3 }),
    rateLimitGate: new ProviderRateLimitGate(),
    requestGate: new MagnetzRequestGate({ intervalMs: requestIntervalMs }),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Magnetz torrent maxResponseBytes",
      1_024,
      4 * 1024 * 1024,
    ),
    resultLimit: resolveBoundedIntegerOption(
      options.resultLimit,
      DEFAULT_RESULT_LIMIT,
      "Magnetz torrent resultLimit",
      1,
      25,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
  };
}

export function createMagnetzTorrentCapabilities(): TorrentProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: ["magnet", "peer_stats", "release_metadata"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("Magnetz torrent provider name is required.");
  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("Magnetz torrent baseUrl must be a valid HTTP(S) URL.", { cause: error });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError("Magnetz torrent baseUrl must be a credential-free HTTP(S) URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}

function normalizeSearchPath(value: string): string {
  const path = value.trim();

  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new TypeError(
      "Magnetz torrent searchPath must be an absolute path without query or hash.",
    );
  }

  return path;
}
