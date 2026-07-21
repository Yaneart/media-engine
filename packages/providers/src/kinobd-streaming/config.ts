import type { MediaAvailability, StreamingProviderCapabilities } from "@media-engine/core";
import { ProviderRateLimitGate, type ProviderFetch } from "../shared/index.js";
import { resolveBoundedIntegerOption } from "../shared/options.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const PROVIDER_NAME = "kinobd-streaming";
const DEFAULT_BASE_URL = "https://kinobd.net";
const DEFAULT_SHIKIMORI_BASE_URL = "https://shikimori.io";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_PLAYER_VALIDATION_LIMIT = 8;
const DEFAULT_PLAYER_VALIDATION_CONCURRENCY = 3;
const DEFAULT_CHILD_REQUEST_LIMIT = 24;
const DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS = 2_500;
const PLAYER_VALIDATION_TIMEOUT_MS = 2_500;
const MAX_SEARCH_LIMIT = 50;
const MAX_PLAYER_VALIDATION_LIMIT = 16;
const MAX_PLAYER_VALIDATION_CONCURRENCY = 4;
const MAX_CHILD_REQUEST_LIMIT = 64;
const MAX_SHIKIMORI_LOOKUP_TIMEOUT_MS = 10_000;
const MAX_PLAYER_VALIDATION_TIMEOUT_MS = 10_000;
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
  playerValidationConcurrency?: number;
  playerValidationTimeoutMs?: number;
  childRequestLimit?: number;
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
  metrics?: KinoBdPlayerAuditMetrics;
}

// Bounded request and validation counters for one availability lookup.
// Счетчики ограниченных запросов и validation для одного availability lookup.
export interface KinoBdPlayerAuditMetrics {
  discovered: number;
  validated: number;
  skippedByLimit: number;
  skippedByBudget: number;
  transientUnknown: number;
  removedConfirmed: number;
  childRequests: number;
}

// Internal normalized provider configuration.
// Внутренняя нормализованная конфигурация provider.
export interface KinoBdStreamingConfig {
  name: string;
  baseUrl: string;
  animeCacheBaseUrl?: string;
  shikimoriBaseUrl: string;
  fetch?: ProviderFetch;
  externalFetch: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  searchLimit: number;
  shikimoriLookupTimeoutMs: number;
  playerValidationLimit: number;
  playerValidationConcurrency: number;
  playerValidationTimeoutMs: number;
  childRequestLimit: number;
  playerProviders: string;
  allowedPlayerProviders: ReadonlySet<string>;
  fast: number;
  userAgent?: string;
  onPlayerAudit?: (audit: KinoBdPlayerAudit) => void;
}

// Builds provider config with ReYohoho-compatible defaults.
// Собирает provider config с ReYohoho-compatible defaults.
export function createConfig(options: KinoBdStreamingProviderOptions): KinoBdStreamingConfig {
  const name = normalizeProviderName(options.name ?? PROVIDER_NAME);
  const searchLimit = resolveBoundedIntegerOption(
    options.searchLimit,
    DEFAULT_SEARCH_LIMIT,
    "KinoBD streaming searchLimit",
    1,
    MAX_SEARCH_LIMIT,
  );
  const shikimoriLookupTimeoutMs = resolveBoundedIntegerOption(
    options.shikimoriLookupTimeoutMs,
    DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS,
    "KinoBD streaming shikimoriLookupTimeoutMs",
    1,
    MAX_SHIKIMORI_LOOKUP_TIMEOUT_MS,
  );
  const playerValidationLimit = resolveBoundedIntegerOption(
    options.playerValidationLimit,
    DEFAULT_PLAYER_VALIDATION_LIMIT,
    "KinoBD streaming playerValidationLimit",
    0,
    MAX_PLAYER_VALIDATION_LIMIT,
  );
  const playerValidationConcurrency = resolveBoundedIntegerOption(
    options.playerValidationConcurrency,
    DEFAULT_PLAYER_VALIDATION_CONCURRENCY,
    "KinoBD streaming playerValidationConcurrency",
    1,
    MAX_PLAYER_VALIDATION_CONCURRENCY,
  );
  const playerValidationTimeoutMs = resolveBoundedIntegerOption(
    options.playerValidationTimeoutMs,
    PLAYER_VALIDATION_TIMEOUT_MS,
    "KinoBD streaming playerValidationTimeoutMs",
    1,
    MAX_PLAYER_VALIDATION_TIMEOUT_MS,
  );
  const childRequestLimit = resolveBoundedIntegerOption(
    options.childRequestLimit,
    DEFAULT_CHILD_REQUEST_LIMIT,
    "KinoBD streaming childRequestLimit",
    1,
    MAX_CHILD_REQUEST_LIMIT,
  );
  const fast = options.fast ?? 1;
  const allowedPlayerProviders = parsePlayerProviderKeys(
    options.playerProviders ?? DEFAULT_PLAYER_PROVIDERS,
  );

  if (!Number.isInteger(fast) || fast < 0) {
    throw new TypeError("KinoBD streaming fast must be a non-negative integer.");
  }

  return {
    name,
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    animeCacheBaseUrl:
      options.animeCacheBaseUrl === undefined
        ? undefined
        : trimTrailingSlash(options.animeCacheBaseUrl),
    shikimoriBaseUrl: trimTrailingSlash(options.shikimoriBaseUrl ?? DEFAULT_SHIKIMORI_BASE_URL),
    fetch: options.fetch,
    externalFetch: options.fetch ?? createHardenedProviderFetch({ provider: name }),
    rateLimitGate: new ProviderRateLimitGate(),
    searchLimit,
    shikimoriLookupTimeoutMs,
    playerValidationLimit,
    playerValidationConcurrency,
    playerValidationTimeoutMs,
    childRequestLimit,
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
