import type { StreamingProvider } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { loadAniLibertyRelease, searchAniLibertyReleases } from "./client.js";
import {
  createAniLibertyCapabilities,
  createAniLibertyConfig,
  type AniLibertyStreamingProviderOptions,
} from "./config.js";
import { mapAniLibertyAvailability } from "./mapping.js";
import { matchesAniLibertyRelease, selectAniLibertyRelease } from "./matching.js";

export type { AniLibertyStreamingProviderOptions } from "./config.js";

export function aniLibertyStreamingProvider(
  options: AniLibertyStreamingProviderOptions = {},
): StreamingProvider {
  const config = createAniLibertyConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createAniLibertyCapabilities(),
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (!canResolveQuery(query)) return null;

      try {
        const candidates = await searchAniLibertyReleases(config, query.title!, context);
        const candidate = selectAniLibertyRelease(candidates, query);
        if (!candidate) return null;

        const loaded = await loadAniLibertyRelease(config, candidate.id, context);
        if (
          !loaded ||
          loaded.release.id !== candidate.id ||
          !matchesAniLibertyRelease(loaded.release, query)
        ) {
          return null;
        }

        return mapAniLibertyAvailability(config.name, loaded.release, query, loaded.sourceUrl);
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        throw error;
      }
    },
  };
}

function canResolveQuery(query: Parameters<StreamingProvider["getAvailability"]>[0]): boolean {
  return (
    query.type === "anime" &&
    Boolean(query.title?.trim()) &&
    Number.isInteger(query.year) &&
    query.seasonNumber === undefined &&
    query.episodeNumber === undefined
  );
}
