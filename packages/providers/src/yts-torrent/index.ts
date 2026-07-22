import type { TorrentProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { searchYtsTorrentMovies } from "./client.js";
import {
  createYtsTorrentCapabilities,
  createYtsTorrentConfig,
  type YtsTorrentProviderOptions,
} from "./config.js";
import { mapYtsTorrentResponse, selectYtsTorrentMovie } from "./mapping.js";

export type { YtsTorrentProviderOptions } from "./config.js";

export function ytsTorrentProvider(options: YtsTorrentProviderOptions = {}): TorrentProvider {
  const config = createYtsTorrentConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "torrent",
    capabilities: createYtsTorrentCapabilities(),
    async discoverTorrents(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      const queryTerm = query.ids?.imdb ?? query.imdb ?? query.title!;

      try {
        const movies = await searchYtsTorrentMovies(config, queryTerm, context);
        const movie = selectYtsTorrentMovie(movies, query);
        return movie ? mapYtsTorrentResponse(config.name, movie, query) : null;
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<TorrentProvider["discoverTorrents"]>[0]): boolean {
  return (
    query.type === "movie" &&
    query.seasonNumber === undefined &&
    query.episodeNumber === undefined &&
    query.absoluteEpisodeNumber === undefined &&
    (Boolean(query.ids?.imdb ?? query.imdb) ||
      (Boolean(query.title?.trim()) && Number.isInteger(query.year)))
  );
}
