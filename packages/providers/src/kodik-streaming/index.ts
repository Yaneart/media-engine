import type { StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { searchKodik } from "./client.js";
import {
  createKodikCapabilities,
  createKodikConfig,
  type KodikStreamingProviderOptions,
} from "./config.js";
import { mapKodikAvailability } from "./mapping.js";

export type { KodikStreamingProviderOptions } from "./config.js";

export function kodikStreamingProvider(options: KodikStreamingProviderOptions): StreamingProvider {
  const config = createKodikConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createKodikCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const search = await searchKodik(config, query, context);
        return search
          ? mapKodikAvailability(config.name, search.results, query, search.sourceUrl, config.now())
          : null;
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  const hasKodikId = Boolean(
    query.ids?.kinopoisk ??
    query.kinopoisk ??
    query.ids?.imdb ??
    query.imdb ??
    (query.type === "anime" ? (query.ids?.shikimori ?? query.shikimori) : undefined),
  );
  if (!hasKodikId) return false;

  const isFilm = query.type === "movie" || (query.type === "anime" && query.animeKind === "movie");
  if (isFilm) {
    return (
      query.seasonNumber === undefined &&
      query.episodeNumber === undefined &&
      query.absoluteEpisodeNumber === undefined
    );
  }
  if (query.type === "anime") {
    const hasAnyEpisodeCoordinate =
      query.seasonNumber !== undefined ||
      query.episodeNumber !== undefined ||
      query.absoluteEpisodeNumber !== undefined;

    return (
      query.animeKind === "tv" &&
      (!hasAnyEpisodeCoordinate ||
        (query.seasonNumber !== undefined &&
          query.episodeNumber !== undefined &&
          query.absoluteEpisodeNumber !== undefined))
    );
  }
  return (
    query.absoluteEpisodeNumber === undefined &&
    ((query.seasonNumber === undefined && query.episodeNumber === undefined) ||
      (query.seasonNumber !== undefined && query.episodeNumber !== undefined))
  );
}
