import type { MediaAvailability, StreamingProviderCapabilities } from "@media-engine/core";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "kinobd-streaming";
const DEFAULT_BASE_URL = "https://kinobd.net";
const DEFAULT_SHIKIMORI_BASE_URL = "https://shikimori.io";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_PLAYER_VALIDATION_LIMIT = 8;
const DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS = 2_500;
const PLAYER_VALIDATION_TIMEOUT_MS = 2_500;
const DEFAULT_PLAYER_PROVIDERS = [
  "collaps",
  "vibix",
  "alloha",
  "kodik",
  "kinotochka",
  "flixcdn",
  "ashdi",
  "turbo",
  "videocdn",
  "bazon",
  "ustore",
  "pleer",
  "videospider",
  "iframe",
  "moonwalk",
  "hdvb",
  "cdnmovies",
  "lookbase",
  "kholobok",
  "videoapi",
  "voidboost",
  "videoseed",
  "vk",
].join(",");
const BLOCKED_PLAYER_PROVIDERS = new Set([
  "ext",
  "ia",
  "netflix",
  "nf",
  "torrent",
  "trailer",
  "trailer_local",
  "youtube",
]);

// Options used to create the no-token KinoBD/ReYohoho-style streaming provider.
// Опции для создания no-token KinoBD/ReYohoho-style streaming-провайдера.
export interface KinoBdStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  animeCacheBaseUrl?: string;
  shikimoriBaseUrl?: string;
  fetch?: ProviderFetch;
  searchLimit?: number;
  shikimoriLookupTimeoutMs?: number;
  playerValidationLimit?: number;
  playerValidationTimeoutMs?: number;
  playerProviders?: string;
  fast?: number;
  userAgent?: string;
  onPlayerAudit?: (audit: KinoBdPlayerAudit) => void;
}

// Stable reasons why a discovered KinoBD player was not returned.
// Стабильные причины, по которым найденный KinoBD player не был возвращен.
export type KinoBdPlayerFilterReason =
  "provider_not_allowed" | "missing_iframe" | "known_broken_url" | "player_validation_failed";

// One player removed during mapping or live validation.
// Один player, удаленный во время mapping или live validation.
export interface KinoBdFilteredPlayerAuditEntry {
  player: string;
  reason: KinoBdPlayerFilterReason;
  url?: string;
}

// Diagnostic snapshot emitted after one KinoBD player lookup.
// Диагностический snapshot после одного KinoBD player lookup.
export interface KinoBdPlayerAudit {
  query: MediaAvailability["query"];
  discovered: string[];
  shown: string[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

// Internal normalized provider configuration.
// Внутренняя нормализованная конфигурация provider.
export interface KinoBdStreamingConfig {
  name: string;
  baseUrl: string;
  animeCacheBaseUrl?: string;
  shikimoriBaseUrl: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
  shikimoriLookupTimeoutMs: number;
  playerValidationLimit: number;
  playerValidationTimeoutMs: number;
  playerProviders: string;
  allowedPlayerProviders: ReadonlySet<string>;
  fast: number;
  userAgent?: string;
  onPlayerAudit?: (audit: KinoBdPlayerAudit) => void;
}

// Builds provider config with ReYohoho-compatible defaults.
// Собирает provider config с ReYohoho-compatible defaults.
export function createConfig(options: KinoBdStreamingProviderOptions): KinoBdStreamingConfig {
  const searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  const shikimoriLookupTimeoutMs =
    options.shikimoriLookupTimeoutMs ?? DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS;
  const playerValidationLimit = options.playerValidationLimit ?? DEFAULT_PLAYER_VALIDATION_LIMIT;
  const playerValidationTimeoutMs =
    options.playerValidationTimeoutMs ?? PLAYER_VALIDATION_TIMEOUT_MS;
  const fast = options.fast ?? 1;
  const allowedPlayerProviders = parsePlayerProviderKeys(
    options.playerProviders ?? DEFAULT_PLAYER_PROVIDERS,
  );

  if (!Number.isInteger(searchLimit) || searchLimit <= 0) {
    throw new TypeError("KinoBD streaming searchLimit must be a positive integer.");
  }

  if (!Number.isInteger(shikimoriLookupTimeoutMs) || shikimoriLookupTimeoutMs <= 0) {
    throw new TypeError("KinoBD streaming shikimoriLookupTimeoutMs must be a positive integer.");
  }

  if (!Number.isInteger(playerValidationLimit) || playerValidationLimit < 0) {
    throw new TypeError("KinoBD streaming playerValidationLimit must be a non-negative integer.");
  }

  if (!Number.isInteger(playerValidationTimeoutMs) || playerValidationTimeoutMs <= 0) {
    throw new TypeError("KinoBD streaming playerValidationTimeoutMs must be a positive integer.");
  }

  if (!Number.isInteger(fast) || fast < 0) {
    throw new TypeError("KinoBD streaming fast must be a non-negative integer.");
  }

  return {
    name: normalizeProviderName(options.name ?? PROVIDER_NAME),
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    animeCacheBaseUrl:
      options.animeCacheBaseUrl === undefined
        ? undefined
        : trimTrailingSlash(options.animeCacheBaseUrl),
    shikimoriBaseUrl: trimTrailingSlash(options.shikimoriBaseUrl ?? DEFAULT_SHIKIMORI_BASE_URL),
    fetch: options.fetch,
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit,
    shikimoriLookupTimeoutMs,
    playerValidationLimit,
    playerValidationTimeoutMs,
    playerProviders: [...allowedPlayerProviders].join(","),
    allowedPlayerProviders,
    fast,
    userAgent: options.userAgent,
    onPlayerAudit: options.onPlayerAudit,
  };
}

// Builds safe capabilities for the public engine/API.
// Собирает безопасные capabilities для публичного engine/API.
export function createCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: true,
      byExternalIds: ["kinopoisk", "shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  };
}

function parsePlayerProviderKeys(playerProviders: string): ReadonlySet<string> {
  return new Set(
    playerProviders
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider) => provider && !BLOCKED_PLAYER_PROVIDERS.has(provider)),
  );
}

// Validates and normalizes provider name.
// Проверяет и нормализует имя provider.
function normalizeProviderName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new TypeError("KinoBD streaming provider name is required.");
  }

  return normalized;
}

// Removes trailing slashes from base URLs.
// Убирает trailing slashes из base URLs.
function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new TypeError("KinoBD streaming baseUrl is required.");
  }

  return trimmed.replace(/\/+$/, "");
}
