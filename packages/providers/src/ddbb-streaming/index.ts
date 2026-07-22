import type { MediaAvailability, StreamingProvider } from "@media-engine/core";
import { loadDdbbPlayers } from "./client.js";
import {
  createDdbbCapabilities,
  createDdbbConfig,
  type DdbbStreamingProviderOptions,
} from "./config.js";
import { mapDdbbPlayers, resolveDdbbLookup } from "./mapping.js";
import { filterDdbbPlayerOptions } from "./validation.js";

export type { DdbbStreamingProviderOptions } from "./config.js";

export function ddbbStreamingProvider(
  options: DdbbStreamingProviderOptions = {},
): StreamingProvider {
  const config = createDdbbConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createDdbbCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (hasEpisodeQuery(query)) return null;

      const lookup = resolveDdbbLookup(query);
      if (!lookup) return null;

      const response = await loadDdbbPlayers(config, lookup, context);
      const mapped = mapDdbbPlayers(
        config.name,
        response.players,
        query,
        lookup,
        response.sourceUrl,
        config.playerLimit,
      );
      if (mapped.options.length === 0) return null;

      const options = await filterDdbbPlayerOptions(config, mapped.options, context);
      if (options.length === 0) return null;

      return {
        query,
        item: {
          type: query.type,
          title: query.title,
          year: query.year,
          ids: mapped.ids,
        },
        options,
        sourceProviders: [
          {
            provider: config.name,
            url: response.sourceUrl,
            ids: mapped.ids,
          },
        ],
        checkedAt: new Date().toISOString(),
      } satisfies MediaAvailability;
    },
  };
}

function hasEpisodeQuery(query: MediaAvailability["query"]): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}
