import type { StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { createFilmixSourceUrl, loadFilmixPost, searchFilmixPosts } from "./client.js";
import {
  createFilmixCapabilities,
  createFilmixConfig,
  type FilmixStreamingProviderOptions,
} from "./config.js";
import { mapFilmixAvailability } from "./mapping.js";
import { matchesSelectedFilmixPost, selectFilmixPost } from "./matching.js";

export type { FilmixStreamingProviderOptions } from "./config.js";

export function filmixStreamingProvider(
  options: FilmixStreamingProviderOptions = {},
): StreamingProvider {
  const config = createFilmixConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createFilmixCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const candidates = await searchFilmixPosts(config, query.title!, context);
        const candidate = selectFilmixPost(candidates, query);
        if (!candidate) return null;

        const post = await loadFilmixPost(config, candidate.id, context);
        if (!post || !matchesSelectedFilmixPost(post, candidate)) return null;

        return mapFilmixAvailability(
          config.name,
          post,
          query,
          createFilmixSourceUrl(config, candidate),
          config.now(),
          config.linkTtlMs,
        );
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  if (!Boolean(query.title?.trim()) || !Number.isInteger(query.year)) return false;

  if (query.type === "movie") {
    return (
      query.seasonNumber === undefined &&
      query.episodeNumber === undefined &&
      query.absoluteEpisodeNumber === undefined
    );
  }

  return (
    query.type === "series" &&
    Number.isInteger(query.seasonNumber) &&
    Number.isInteger(query.episodeNumber) &&
    query.absoluteEpisodeNumber === undefined
  );
}
