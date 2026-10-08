import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "kodik-streaming";
const DEFAULT_BASE_URL = "https://kodik-api.com";
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_RESULT_LIMIT = 100;

export interface KodikStreamingProviderOptions {
  apiKey: string;
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  resultLimit?: number;
  userAgent?: string;
  now?: () => number;
}

export interface KodikStreamingConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  resultLimit: number;
  userAgent: string;
  now: () => number;
}

export function createKodikConfig(options: KodikStreamingProviderOptions): KodikStreamingConfig {
  const name = normalizeRequiredValue(options.name ?? DEFAULT_PROVIDER_NAME, "provider name", 100);

  return {
    name,
    apiKey: normalizeRequiredValue(options.apiKey, "apiKey", 4_096),
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 2 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Kodik streaming maxResponseBytes",
      1_024,
      16 * 1024 * 1024,
    ),
    resultLimit: resolveBoundedIntegerOption(
      options.resultLimit,
      DEFAULT_RESULT_LIMIT,
      "Kodik streaming resultLimit",
      1,
      100,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
    now: options.now ?? Date.now,
  };
}

export function createKodikCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    animeKinds: ["movie", "tv"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk", "imdb", "shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  };
}

function normalizeRequiredValue(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`Kodik streaming ${label} is invalid.`);
  }
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("Kodik streaming baseUrl must be a valid HTTPS URL.", { cause: error });
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("Kodik streaming baseUrl must be a credential-free HTTPS URL.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
