import type { TorrentProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "yts-torrent";
const DEFAULT_BASE_URL = "https://movies-api.accel.li";
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_RESULT_LIMIT = 10;

export interface YtsTorrentProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  resultLimit?: number;
  userAgent?: string;
}

export interface YtsTorrentConfig {
  name: string;
  baseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  resultLimit: number;
  userAgent: string;
}

export function createYtsTorrentConfig(options: YtsTorrentProviderOptions): YtsTorrentConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 3 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "YTS torrent maxResponseBytes",
      1_024,
      4 * 1024 * 1024,
    ),
    resultLimit: resolveBoundedIntegerOption(
      options.resultLimit,
      DEFAULT_RESULT_LIMIT,
      "YTS torrent resultLimit",
      1,
      50,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
  };
}

export function createYtsTorrentCapabilities(): TorrentProviderCapabilities {
  return {
    mediaTypes: ["movie"],
    lookup: {
      byTitle: true,
      byExternalIds: ["imdb"],
      byEpisode: false,
    },
    features: ["magnet", "peer_stats", "release_metadata"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();

  if (!name) {
    throw new TypeError("YTS torrent provider name is required.");
  }

  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("YTS torrent baseUrl must be a valid HTTP(S) URL.", { cause: error });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError("YTS torrent baseUrl must be a credential-free HTTP(S) URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
