import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "veoveo-streaming";
const DEFAULT_LOOKUP_BASE_URL = "https://p2.ddbb.lol";
const DEFAULT_STREAM_BASE_URL = "https://api.rstprgapipt.com";
const DEFAULT_MAX_LOOKUP_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_CATALOG_ITEM_LIMIT = 300;
const DEFAULT_VARIANT_LIMIT = 8;
const DEFAULT_LINK_TTL_MS = 5 * 60_000;

export interface VeoVeoStreamingProviderOptions {
  name?: string;
  version?: string;
  lookupBaseUrl?: string;
  streamBaseUrl?: string;
  fetch?: ProviderFetch;
  maxLookupResponseBytes?: number;
  maxCatalogResponseBytes?: number;
  catalogItemLimit?: number;
  variantLimit?: number;
  linkTtlMs?: number;
  userAgent?: string;
  now?: () => number;
}

export interface VeoVeoStreamingConfig {
  name: string;
  lookupBaseUrl: string;
  streamBaseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxLookupResponseBytes: number;
  maxCatalogResponseBytes: number;
  catalogItemLimit: number;
  variantLimit: number;
  linkTtlMs: number;
  userAgent: string;
  now: () => number;
}

export function createVeoVeoConfig(options: VeoVeoStreamingProviderOptions): VeoVeoStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    lookupBaseUrl: normalizeBaseUrl(
      options.lookupBaseUrl ?? DEFAULT_LOOKUP_BASE_URL,
      "lookupBaseUrl",
    ),
    streamBaseUrl: normalizeBaseUrl(
      options.streamBaseUrl ?? DEFAULT_STREAM_BASE_URL,
      "streamBaseUrl",
    ),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 2 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxLookupResponseBytes: resolveBoundedIntegerOption(
      options.maxLookupResponseBytes,
      DEFAULT_MAX_LOOKUP_RESPONSE_BYTES,
      "VeoVeo streaming maxLookupResponseBytes",
      1_024,
      4 * 1024 * 1024,
    ),
    maxCatalogResponseBytes: resolveBoundedIntegerOption(
      options.maxCatalogResponseBytes,
      DEFAULT_MAX_CATALOG_RESPONSE_BYTES,
      "VeoVeo streaming maxCatalogResponseBytes",
      1_024,
      16 * 1024 * 1024,
    ),
    catalogItemLimit: resolveBoundedIntegerOption(
      options.catalogItemLimit,
      DEFAULT_CATALOG_ITEM_LIMIT,
      "VeoVeo streaming catalogItemLimit",
      1,
      1_000,
    ),
    variantLimit: resolveBoundedIntegerOption(
      options.variantLimit,
      DEFAULT_VARIANT_LIMIT,
      "VeoVeo streaming variantLimit",
      1,
      32,
    ),
    linkTtlMs: resolveBoundedIntegerOption(
      options.linkTtlMs,
      DEFAULT_LINK_TTL_MS,
      "VeoVeo streaming linkTtlMs",
      30_000,
      60 * 60_000,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
    now: options.now ?? Date.now,
  };
}

export function createVeoVeoCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk", "imdb"],
      byEpisode: true,
    },
    features: ["hls", "translations", "qualities", "episode_mapping"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("VeoVeo streaming provider name is required.");
  return name;
}

function normalizeBaseUrl(value: string, option: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError(`VeoVeo streaming ${option} must be a valid HTTP(S) URL.`, {
      cause: error,
    });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError(`VeoVeo streaming ${option} must be a credential-free HTTP(S) URL.`);
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
