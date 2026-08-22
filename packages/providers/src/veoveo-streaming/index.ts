import type { StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import {
  loadVeoVeoCatalog,
  lookupVeoVeoContentId,
  resolveVeoVeoLookup,
  resolveVeoVeoManifestUrls,
} from "./client.js";
import {
  createVeoVeoCapabilities,
  createVeoVeoConfig,
  type VeoVeoStreamingProviderOptions,
} from "./config.js";
import { mapVeoVeoAvailability } from "./mapping.js";

export type { VeoVeoStreamingProviderOptions } from "./config.js";

export function veoVeoStreamingProvider(
  options: VeoVeoStreamingProviderOptions = {},
): StreamingProvider {
  const config = createVeoVeoConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createVeoVeoCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      const lookup = resolveVeoVeoLookup(query);
      if (!lookup) return null;

      try {
        const resolved = await lookupVeoVeoContentId(config, lookup, context);
        if (!resolved) return null;

        const rawCatalog = await loadVeoVeoCatalog(config, resolved.contentId, context);
        const catalog = await resolveVeoVeoManifestUrls(config, rawCatalog, query, context);
        const now = config.now();
        return mapVeoVeoAvailability(
          config.name,
          resolved.contentId,
          catalog,
          query,
          lookup,
          resolved.sourceUrl,
          new Date(now + config.linkTtlMs).toISOString(),
          new Date(now).toISOString(),
        );
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  if (query.type !== "movie" && query.type !== "series") return false;
  if (query.absoluteEpisodeNumber !== undefined) return false;
  if (query.type === "movie") {
    return query.seasonNumber === undefined && query.episodeNumber === undefined;
  }
  return query.episodeNumber === undefined || query.seasonNumber !== undefined;
}
