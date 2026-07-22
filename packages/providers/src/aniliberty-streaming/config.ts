import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "aniliberty-streaming";
const DEFAULT_BASE_URL = "https://aniliberty.top";
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SEARCH_RESULT_LIMIT = 50;
const DEFAULT_EPISODE_LIMIT = 200;

export interface AniLibertyStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  searchResultLimit?: number;
  episodeLimit?: number;
  userAgent?: string;
}

export interface AniLibertyStreamingConfig {
  name: string;
  baseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  searchResultLimit: number;
  episodeLimit: number;
  userAgent: string;
}

export function createAniLibertyConfig(
  options: AniLibertyStreamingProviderOptions,
): AniLibertyStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 3 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "AniLiberty streaming maxResponseBytes",
      1_024,
      16 * 1024 * 1024,
    ),
    searchResultLimit: resolveBoundedIntegerOption(
      options.searchResultLimit,
      DEFAULT_SEARCH_RESULT_LIMIT,
      "AniLiberty streaming searchResultLimit",
      1,
      100,
    ),
    episodeLimit: resolveBoundedIntegerOption(
      options.episodeLimit,
      DEFAULT_EPISODE_LIMIT,
      "AniLiberty streaming episodeLimit",
      1,
      1_000,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
  };
}

export function createAniLibertyCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["anime"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: ["hls", "translations", "qualities", "episode_mapping"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();

  if (!name) {
    throw new TypeError("AniLiberty streaming provider name is required.");
  }

  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("AniLiberty streaming baseUrl must be a valid HTTP(S) URL.", {
      cause: error,
    });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError("AniLiberty streaming baseUrl must be a credential-free HTTP(S) URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
