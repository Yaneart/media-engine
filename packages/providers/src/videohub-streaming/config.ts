import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "videohub-streaming";
const DEFAULT_BASE_URL = "https://plapi.cdnvideohub.com";
const DEFAULT_MAX_PLAYLIST_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_VIDEO_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_PLAYLIST_ITEM_LIMIT = 1_000;
const DEFAULT_VIDEO_LOOKUP_LIMIT = 8;
const DEFAULT_VIDEO_LOOKUP_CONCURRENCY = 4;
const DEFAULT_VIDEO_LOOKUP_TIMEOUT_MS = 15_000;
const DEFAULT_LINK_TTL_MS = 5 * 60_000;
const DEFAULT_ADDRESS_ATTEMPT_TIMEOUT_MS = 3_500;

export interface VideoHubStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxPlaylistResponseBytes?: number;
  maxVideoResponseBytes?: number;
  playlistItemLimit?: number;
  videoLookupLimit?: number;
  videoLookupConcurrency?: number;
  videoLookupTimeoutMs?: number;
  linkTtlMs?: number;
  userAgent?: string;
  now?: () => number;
}

export interface VideoHubStreamingConfig {
  name: string;
  baseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxPlaylistResponseBytes: number;
  maxVideoResponseBytes: number;
  playlistItemLimit: number;
  videoLookupLimit: number;
  videoLookupConcurrency: number;
  videoLookupTimeoutMs: number;
  linkTtlMs: number;
  userAgent: string;
  now: () => number;
}

export function createVideoHubConfig(
  options: VideoHubStreamingProviderOptions,
): VideoHubStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    fetch:
      options.fetch ??
      createHardenedProviderFetch({
        provider: name,
        maxRedirects: 2,
        addressAttemptTimeoutMs: DEFAULT_ADDRESS_ATTEMPT_TIMEOUT_MS,
      }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxPlaylistResponseBytes: resolveBoundedIntegerOption(
      options.maxPlaylistResponseBytes,
      DEFAULT_MAX_PLAYLIST_RESPONSE_BYTES,
      "VideoHUB streaming maxPlaylistResponseBytes",
      1_024,
      16 * 1024 * 1024,
    ),
    maxVideoResponseBytes: resolveBoundedIntegerOption(
      options.maxVideoResponseBytes,
      DEFAULT_MAX_VIDEO_RESPONSE_BYTES,
      "VideoHUB streaming maxVideoResponseBytes",
      1_024,
      4 * 1024 * 1024,
    ),
    playlistItemLimit: resolveBoundedIntegerOption(
      options.playlistItemLimit,
      DEFAULT_PLAYLIST_ITEM_LIMIT,
      "VideoHUB streaming playlistItemLimit",
      1,
      5_000,
    ),
    videoLookupLimit: resolveBoundedIntegerOption(
      options.videoLookupLimit,
      DEFAULT_VIDEO_LOOKUP_LIMIT,
      "VideoHUB streaming videoLookupLimit",
      1,
      32,
    ),
    videoLookupConcurrency: resolveBoundedIntegerOption(
      options.videoLookupConcurrency,
      DEFAULT_VIDEO_LOOKUP_CONCURRENCY,
      "VideoHUB streaming videoLookupConcurrency",
      1,
      8,
    ),
    videoLookupTimeoutMs: resolveBoundedIntegerOption(
      options.videoLookupTimeoutMs,
      DEFAULT_VIDEO_LOOKUP_TIMEOUT_MS,
      "VideoHUB streaming videoLookupTimeoutMs",
      500,
      15_000,
    ),
    linkTtlMs: resolveBoundedIntegerOption(
      options.linkTtlMs,
      DEFAULT_LINK_TTL_MS,
      "VideoHUB streaming linkTtlMs",
      30_000,
      60 * 60_000,
    ),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
    now: options.now ?? Date.now,
  };
}

export function createVideoHubCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: false,
      byExternalIds: ["kinopoisk"],
      byEpisode: true,
    },
    features: ["mp4", "translations", "qualities", "episode_mapping", "episode_catalog", "headers"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("VideoHUB streaming provider name is required.");
  return name;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError("VideoHUB streaming baseUrl must be a valid HTTPS URL.", {
      cause: error,
    });
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new TypeError("VideoHUB streaming baseUrl must be a credential-free HTTPS URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
