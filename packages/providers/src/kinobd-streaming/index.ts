import type {
  MediaAvailability,
  ProviderContext,
  StreamOption,
  StreamingProvider,
} from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import {
  createCapabilities,
  createConfig,
  type KinoBdFilteredPlayerAuditEntry,
  type KinoBdStreamingConfig,
  type KinoBdStreamingProviderOptions,
} from "./config.js";
import {
  collectCandidateIds,
  createAnimeTitleFallbackQuery,
  getCandidateStartYear,
  normalizeSearchText,
  type PlayerCandidate,
  searchPlayerCandidates,
  selectBestPlayerCandidate,
} from "./candidates.js";
import {
  extractIframeUrl,
  hasEpisodeQuery,
  loadPlayerData,
  mapCandidatesToFallbackOptions,
  mapPlayerMapToOptions,
  type PlayerDataResponse,
} from "./players.js";

export type {
  KinoBdFilteredPlayerAuditEntry,
  KinoBdPlayerAudit,
  KinoBdPlayerFilterReason,
  KinoBdStreamingProviderOptions,
} from "./config.js";

const PLAYER_VALIDATION_MAX_DEPTH = 1;
const PLAYER_VALIDATION_MAX_BODY_BYTES = 256 * 1024;

// Creates a no-token streaming provider that asks KinoBD-style endpoints for iframe players.
// Создает no-token streaming-провайдер, который запрашивает iframe-плееры через KinoBD-style endpoints.
export function kinobdStreamingProvider(
  options: KinoBdStreamingProviderOptions = {},
): StreamingProvider {
  const config = createConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createCapabilities(),
    async getAvailability(query, context) {
      return getKinoBdAvailability(config, query, context);
    },
  };
}

interface PlayerOptionFilterResult {
  options: StreamOption[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

// Resolves availability through movie/series or anime player endpoints.
// Получает availability через movie/series или anime player endpoints.
async function getKinoBdAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | null> {
  if (query.providers && !query.providers.includes(config.name)) {
    return null;
  }

  if (query.type === "anime") {
    return getAnimeAvailability(config, query, context);
  }

  return getMovieOrSeriesAvailability(config, query, context);
}

// Resolves anime availability through optional cache_shiki first, then KinoBD title fallback.
// Получает anime availability через опциональный cache_shiki, затем через KinoBD title fallback.
async function getAnimeAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability> {
  if (config.animeCacheBaseUrl && query.ids?.shikimori) {
    const cached = await tryGetShikimoriCacheAvailability(config, query, context);

    if (cached && cached.options.length > 0) {
      return cached;
    }
  }

  const fallbackQuery = await createAnimeTitleFallbackQuery(config, query, context);

  if (!fallbackQuery.title && !fallbackQuery.ids?.kinopoisk) {
    return createEmptyAvailability(query);
  }

  return getMovieOrSeriesAvailability(config, fallbackQuery, context);
}

// Resolves movie or series players through /api/player/search and /playerdata.
// Получает movie или series players через /api/player/search и /playerdata.
async function getMovieOrSeriesAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability> {
  const candidates = await searchPlayerCandidates(config, query, context);
  const selected = selectBestPlayerCandidate(candidates, query);

  if (!selected) {
    return createEmptyAvailability(query);
  }

  const options = await loadPlayerOptions(config, selected, query, context);

  return {
    query,
    item: {
      type: query.type,
      title: selected.title ?? selected.name_russian ?? query.title,
      originalTitle: selected.name_original ?? undefined,
      year: getCandidateStartYear(selected) ?? query.year,
      ids: collectCandidateIds(selected) ?? query.ids,
    },
    options,
    sourceProviders: [
      {
        provider: config.name,
        ids: collectCandidateIds(selected) ?? query.ids,
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

// Loads playerdata first and falls back to candidate iframes when the player endpoint is unavailable.
// Сначала грузит playerdata и откатывается к iframe-кандидатам, если player endpoint недоступен.
async function loadPlayerOptions(
  config: KinoBdStreamingConfig,
  selected: PlayerCandidate,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<StreamOption[]> {
  try {
    const playerData = await loadPlayerData(config, selected, context);
    const mapping = mapPlayerMapToOptions(
      config.name,
      playerData,
      selected,
      query,
      config.allowedPlayerProviders,
    );

    if (mapping.options.length > 0) {
      const filtered = await filterBrokenPlayerOptions(config, mapping.options, context);

      emitPlayerAudit(config, query, mapping.discovered, filtered.options, [
        ...mapping.filtered,
        ...filtered.filtered,
      ]);

      return filtered.options;
    }

    const fallbackOptions = mapCandidatesToFallbackOptions(config.name, [selected], query);

    emitPlayerAudit(config, query, mapping.discovered, fallbackOptions, mapping.filtered);

    return fallbackOptions;
  } catch {
    // KinoBD/ReYohoho-style /playerdata can be rate-limited or temporarily unavailable.
    // KinoBD/ReYohoho-style /playerdata может быть rate-limited или временно недоступен.
  }

  const fallbackOptions = mapCandidatesToFallbackOptions(config.name, [selected], query);

  emitPlayerAudit(
    config,
    query,
    fallbackOptions.map((option) => option.player.label),
    fallbackOptions,
    [],
  );

  return fallbackOptions;
}

// Resolves anime players through /cache_shiki-compatible backend endpoint.
// Получает anime players через /cache_shiki-compatible backend endpoint.
async function tryGetShikimoriCacheAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | undefined> {
  const url = new URL("/cache_shiki", `${config.animeCacheBaseUrl}/`);
  const body = new URLSearchParams({
    shikimori: query.ids!.shikimori!,
    type: "anime",
  });

  try {
    const playerData = await fetchJson<PlayerDataResponse>({
      provider: config.name,
      url,
      context,
      fetch: config.fetch,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    });
    const mapping = mapPlayerMapToOptions(
      config.name,
      playerData,
      undefined,
      query,
      config.allowedPlayerProviders,
    );
    const options = mapping.options;

    emitPlayerAudit(config, query, mapping.discovered, options, mapping.filtered);

    return {
      query,
      item: {
        type: "anime",
        title: query.title,
        year: query.year,
        ids: query.ids,
      },
      episodes: hasEpisodeQuery(query)
        ? [
            {
              seasonNumber: query.seasonNumber,
              episodeNumber: query.episodeNumber,
              absoluteEpisodeNumber: query.absoluteEpisodeNumber,
              options,
            },
          ]
        : undefined,
      options,
      sourceProviders: [
        {
          provider: config.name,
          ids: query.ids,
        },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

async function filterBrokenPlayerOptions(
  config: KinoBdStreamingConfig,
  options: StreamOption[],
  context: ProviderContext,
): Promise<PlayerOptionFilterResult> {
  const knownBrokenOptions = options.filter((option) => isKnownBrokenPlayerUrl(option.access.url));
  const optionsWithoutKnownBrokenUrls = options.filter(
    (option) => !knownBrokenOptions.includes(option),
  );
  const optionsToValidate = optionsWithoutKnownBrokenUrls.slice(0, config.playerValidationLimit);
  const optionsSkippedByLimit = optionsWithoutKnownBrokenUrls.slice(config.playerValidationLimit);
  const checks = await Promise.all(
    optionsToValidate.map(async (option) => ({
      option,
      broken: await isBrokenPlayerUrl(config, option.access.url, context),
    })),
  );

  return {
    options: [
      ...checks.filter((check) => !check.broken).map((check) => check.option),
      ...optionsSkippedByLimit,
    ],
    filtered: [
      ...knownBrokenOptions.map((option) => ({
        player: option.player.label,
        reason: "known_broken_url" as const,
        url: option.access.url,
      })),
      ...checks
        .filter((check) => check.broken)
        .map((check) => ({
          player: check.option.player.label,
          reason: "player_validation_failed" as const,
          url: check.option.access.url,
        })),
    ],
  };
}

function emitPlayerAudit(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  discovered: string[],
  shown: StreamOption[],
  filtered: KinoBdFilteredPlayerAuditEntry[],
): void {
  try {
    config.onPlayerAudit?.({
      query: {
        ...query,
        ...(query.ids ? { ids: { ...query.ids } } : {}),
        ...(query.providers ? { providers: [...query.providers] } : {}),
      },
      discovered: [...new Set(discovered)],
      shown: [...new Set(shown.map((option) => option.player.label))],
      filtered,
    });
  } catch {
    // Diagnostics must not change availability behavior.
  }
}

async function isBrokenPlayerUrl(
  config: KinoBdStreamingConfig,
  url: string,
  context: ProviderContext,
  depth = 0,
): Promise<boolean> {
  const fetchImpl = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.playerValidationTimeoutMs);
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;

  try {
    if (context.signal?.aborted) {
      return false;
    }

    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal,
    });

    if (response.status === 404 || response.status === 410 || response.status >= 500) {
      return true;
    }

    if (!response.ok) {
      return false;
    }

    const html = await readBoundedResponseText(response, PLAYER_VALIDATION_MAX_BODY_BYTES);

    if (hasBrokenPlayerMarker(html)) {
      return true;
    }

    const nestedUrl = depth < PLAYER_VALIDATION_MAX_DEPTH ? extractIframeUrl(html, url) : undefined;

    return nestedUrl ? isBrokenPlayerUrl(config, nestedUrl, context, depth + 1) : false;
  } catch {
    return isKnownBrokenPlayerUrl(url);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes <= maxBytes) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        break;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

function isKnownBrokenPlayerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      /(^|\.)sevstar\d*krop\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/iframe")
    );
  } catch {
    return false;
  }
}

function hasBrokenPlayerMarker(html: string): boolean {
  const normalized = normalizeSearchText(html);

  return (
    normalized.includes("video not found") ||
    normalized.includes("404 not found") ||
    normalized.includes("плеер недоступ") ||
    normalized.includes("плеєр недоступ") ||
    normalized.includes("недоступний для перегляду") ||
    normalized.includes("змініть країну перегляду")
  );
}

// Creates an empty availability response without failing metadata flows.
// Создает пустой availability response без поломки metadata flows.
function createEmptyAvailability(query: MediaAvailability["query"]): MediaAvailability {
  return {
    query,
    options: [],
    sourceProviders: [],
    checkedAt: new Date().toISOString(),
  };
}
