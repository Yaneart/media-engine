import type { StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { searchRutubeMovies } from "./client.js";
import {
  createRutubeCapabilities,
  createRutubeConfig,
  type RutubeStreamingProviderOptions,
} from "./config.js";
import { mapRutubeAvailability } from "./mapping.js";
import { selectRutubeMovie } from "./matching.js";

export type { RutubeStreamingProviderOptions } from "./config.js";

export function rutubeStreamingProvider(
  options: RutubeStreamingProviderOptions = {},
): StreamingProvider {
  const config = createRutubeConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createRutubeCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const candidates = await searchRutubeMovies(config, query.title!, query.year!, context);
        const candidate = selectRutubeMovie(
          candidates,
          query.title!,
          query.year!,
          config.minDurationSeconds,
        );
        return candidate ? mapRutubeAvailability(config, candidate, query) : null;
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  return (
    query.type === "movie" &&
    Boolean(query.title?.trim()) &&
    Number.isInteger(query.year) &&
    query.seasonNumber === undefined &&
    query.episodeNumber === undefined &&
    query.absoluteEpisodeNumber === undefined
  );
}
