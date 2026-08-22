import { randomBytes } from "node:crypto";

import type { StreamingProviderCapabilities } from "@media-engine/core";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const DEFAULT_PROVIDER_NAME = "filmix-streaming";
const DEFAULT_BASE_URL = "http://filmixapp.cyou/api/v2";
const DEFAULT_SITE_BASE_URL = "https://filmix.my";
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SEARCH_RESULT_LIMIT = 50;
const DEFAULT_SEASON_LIMIT = 100;
const DEFAULT_TRANSLATION_LIMIT = 50;
const DEFAULT_EPISODE_LIMIT = 500;
const DEFAULT_LINK_TTL_MS = 15 * 60_000;

export interface FilmixStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  siteBaseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  searchResultLimit?: number;
  seasonLimit?: number;
  translationLimit?: number;
  episodeLimit?: number;
  linkTtlMs?: number;
  deviceId?: string;
  userAgent?: string;
  now?: () => number;
}

export interface FilmixStreamingConfig {
  name: string;
  baseUrl: string;
  siteBaseUrl: string;
  fetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxResponseBytes: number;
  searchResultLimit: number;
  seasonLimit: number;
  translationLimit: number;
  episodeLimit: number;
  linkTtlMs: number;
  deviceId: string;
  userAgent: string;
  now: () => number;
}

export function createFilmixConfig(options: FilmixStreamingProviderOptions): FilmixStreamingConfig {
  const name = normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME);

  return {
    name,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl"),
    siteBaseUrl: normalizeBaseUrl(options.siteBaseUrl ?? DEFAULT_SITE_BASE_URL, "siteBaseUrl"),
    fetch: options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 2 }),
    rateLimitGate: new ProviderRateLimitGate(),
    maxResponseBytes: resolveBoundedIntegerOption(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Filmix streaming maxResponseBytes",
      1_024,
      16 * 1024 * 1024,
    ),
    searchResultLimit: resolveBoundedIntegerOption(
      options.searchResultLimit,
      DEFAULT_SEARCH_RESULT_LIMIT,
      "Filmix streaming searchResultLimit",
      1,
      100,
    ),
    seasonLimit: resolveBoundedIntegerOption(
      options.seasonLimit,
      DEFAULT_SEASON_LIMIT,
      "Filmix streaming seasonLimit",
      1,
      500,
    ),
    translationLimit: resolveBoundedIntegerOption(
      options.translationLimit,
      DEFAULT_TRANSLATION_LIMIT,
      "Filmix streaming translationLimit",
      1,
      100,
    ),
    episodeLimit: resolveBoundedIntegerOption(
      options.episodeLimit,
      DEFAULT_EPISODE_LIMIT,
      "Filmix streaming episodeLimit",
      1,
      2_000,
    ),
    linkTtlMs: resolveBoundedIntegerOption(
      options.linkTtlMs,
      DEFAULT_LINK_TTL_MS,
      "Filmix streaming linkTtlMs",
      60_000,
      2 * 60 * 60_000,
    ),
    deviceId: normalizeDeviceId(options.deviceId ?? randomBytes(8).toString("hex")),
    userAgent: options.userAgent?.trim() || MEDIA_ENGINE_DEFAULT_USER_AGENT,
    now: options.now ?? Date.now,
  };
}

export function createFilmixCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: ["mp4", "translations", "qualities", "episode_mapping"],
  };
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("Filmix streaming provider name is required.");
  return name;
}

function normalizeDeviceId(value: string): string {
  const deviceId = value.trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/u.test(deviceId)) {
    throw new TypeError(
      "Filmix streaming deviceId must contain exactly 16 hexadecimal characters.",
    );
  }
  return deviceId;
}

function normalizeBaseUrl(value: string, option: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new TypeError(`Filmix streaming ${option} must be a valid HTTP(S) URL.`, {
      cause: error,
    });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError(`Filmix streaming ${option} must be a credential-free HTTP(S) URL.`);
  }

  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}
