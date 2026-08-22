import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "rutube-streaming";
const DEFAULT_BASE_URL = "https://rutube.ru";
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SEARCH_RESULT_LIMIT = 20;
const DEFAULT_MIN_DURATION_SECONDS = 3_000;

export interface RutubeStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  searchResultLimit?: number;
  minDurationSeconds?: number;
  userAgent?: string;
  now?: () => number;
}

export interface RutubeStreamingConfig {
  name: string;
  baseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  searchResultLimit: number;
  minDurationSeconds: number;
  userAgent: string;
  now: () => number;
}

export function createRutubeConfig(options: RutubeStreamingProviderOptions): RutubeStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 2 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Rutube streaming maxResponseBytes",
      1_024,
      8 * 1024 * 1024,
    ),
    searchResultLimit: resolveBoundedIntegerOption(
      options.searchResultLimit,
      DEFAULT_SEARCH_RESULT_LIMIT,
      "Rutube streaming searchResultLimit",
      1,
      50,
    ),
    minDurationSeconds: resolveBoundedIntegerOption(
      options.minDurationSeconds,
      DEFAULT_MIN_DURATION_SECONDS,
      "Rutube streaming minDurationSeconds",
      60,
      12 * 60 * 60,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
    now: options.now ?? Date.now,
  };
}

export function createRutubeCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: false,
    },
    features: ["embed"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("Rutube streaming provider name is required.");
  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("Rutube streaming baseUrl must be a valid HTTPS URL.", { cause: error });
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new TypeError("Rutube streaming baseUrl must be a credential-free HTTPS URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
