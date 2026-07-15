import type { MediaAvailability, ProviderContext, StreamOption } from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import type { KinoBdStreamingConfig } from "./config.js";
import {
  collectCandidateIds,
  createAnimeTitleFallbackQuery,
  getCandidateStartYear,
  type PlayerCandidate,
  searchPlayerCandidates,
  selectBestPlayerCandidate,
} from "./candidates.js";
import {
  hasEpisodeQuery,
  loadPlayerData,
  mapCandidatesToFallbackOptions,
  mapPlayerMapToOptions,
  type PlayerDataResponse,
} from "./players.js";
import { emitPlayerAudit, filterBrokenPlayerOptions } from "./validation.js";

// Resolves availability through movie/series or anime player endpoints.
// Получает availability через movie/series или anime player endpoints.
export async function getKinoBdAvailability(
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
