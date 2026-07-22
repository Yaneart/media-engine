import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "ddbb-streaming";
const DEFAULT_BASE_URL = "https://p2.ddbb.lol";
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_PLAYER_LIMIT = 16;
const DEFAULT_PLAYER_VALIDATION_LIMIT = 8;
const DEFAULT_PLAYER_VALIDATION_CONCURRENCY = 3;
const DEFAULT_PLAYER_VALIDATION_TIMEOUT_MS = 2_500;
const DEFAULT_PLAYER_VALIDATION_MAX_BYTES = 256 * 1024;

export interface DdbbStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  playerLimit?: number;
  playerValidationLimit?: number;
  playerValidationConcurrency?: number;
  playerValidationTimeoutMs?: number;
  playerValidationMaxBytes?: number;
  userAgent?: string;
}

export interface DdbbStreamingConfig {
  name: string;
  baseUrl: string;
  fetch: ProviderFetch;
  externalFetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  playerLimit: number;
  playerValidationLimit: number;
  playerValidationConcurrency: number;
  playerValidationTimeoutMs: number;
  playerValidationMaxBytes: number;
  userAgent: string;
}

export function createDdbbConfig(options: DdbbStreamingProviderOptions): DdbbStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);
  const fetchImpl =
    options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 3 });

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: fetchImpl,
    externalFetch: fetchImpl,
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "DDBB streaming maxResponseBytes",
      1_024,
      4 * 1024 * 1024,
    ),
    playerLimit: resolveBoundedIntegerOption(
      options.playerLimit,
      DEFAULT_PLAYER_LIMIT,
      "DDBB streaming playerLimit",
      1,
      32,
    ),
    playerValidationLimit: resolveBoundedIntegerOption(
      options.playerValidationLimit,
      DEFAULT_PLAYER_VALIDATION_LIMIT,
      "DDBB streaming playerValidationLimit",
      0,
      16,
    ),
    playerValidationConcurrency: resolveBoundedIntegerOption(
      options.playerValidationConcurrency,
      DEFAULT_PLAYER_VALIDATION_CONCURRENCY,
      "DDBB streaming playerValidationConcurrency",
      1,
      4,
    ),
    playerValidationTimeoutMs: resolveBoundedIntegerOption(
      options.playerValidationTimeoutMs,
      DEFAULT_PLAYER_VALIDATION_TIMEOUT_MS,
      "DDBB streaming playerValidationTimeoutMs",
      1,
      10_000,
    ),
    playerValidationMaxBytes: resolveBoundedIntegerOption(
      options.playerValidationMaxBytes,
      DEFAULT_PLAYER_VALIDATION_MAX_BYTES,
      "DDBB streaming playerValidationMaxBytes",
      1_024,
      1024 * 1024,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
  };
}

export function createDdbbCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk", "imdb"],
      byEpisode: false,
    },
    features: ["embed", "translations", "qualities"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();

  if (!name) {
    throw new TypeError("DDBB streaming provider name is required.");
  }

  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("DDBB streaming baseUrl must be a valid HTTP(S) URL.", { cause: error });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError("DDBB streaming baseUrl must be a credential-free HTTP(S) URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
