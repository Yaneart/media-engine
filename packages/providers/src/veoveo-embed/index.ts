import type { StreamingProvider } from "@media-engine/core";
import {
  createVeoVeoConfig,
  type VeoVeoStreamingProviderOptions,
} from "../veoveo-streaming/config.js";
import { lookupVeoVeoContentId } from "../veoveo-streaming/lookup.js";
import { mapEmbedCatalog } from "../shared/embed-catalog.js";
import {
  hasEmbedEpisode,
  resolveEmbedLookup,
  embedError,
  record,
  externalIds,
  text,
} from "../shared/keyed-embed.js";
import { normalizeProviderOutputUrl } from "../shared/output-url.js";

export interface VeoVeoEmbedProviderOptions extends VeoVeoStreamingProviderOptions {
  /** Explicitly permit the provider-issued token in the public iframe URL. */
  allowApiKeyInEmbedUrl?: boolean;
}

/** Generic player: translations and series episodes are selected inside VeoVeo. */
export function veoVeoEmbedProvider(options: VeoVeoEmbedProviderOptions = {}): StreamingProvider {
  const config = createVeoVeoConfig({ ...options, name: options.name ?? "veoveo-embed" });
  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      lookup: { byTitle: false, byExternalIds: ["kinopoisk", "imdb"], byEpisode: false },
      features: ["embed"],
    },
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(config.name)) return null;
      if (hasEmbedEpisode(query)) return null;
      const lookup = resolveEmbedLookup(query, ["kinopoisk", "imdb"]);
      if (!lookup || lookup.source === "tmdb") return null;
      if (!options.allowApiKeyInEmbedUrl)
        throw embedError(
          config.name,
          "PROVIDER_UNAUTHORIZED",
          "requires explicit permission to expose the public iframe token",
        );
      const found = await lookupVeoVeoContentId(
        config,
        { ...lookup, source: lookup.source },
        context,
      );
      if (!found) return null;
      const details = found.details;
      const kind = record(details.contentType)?.name;
      const serial = kind === "Сериалы" ? true : kind === "Фильмы" ? false : undefined;
      if (serial === undefined) return null;
      const url = new URL(found.sourceUrl);
      url.searchParams.set("token", config.apiKey!);
      return mapEmbedCatalog(
        config.name,
        "VeoVeo",
        [
          {
            id: found.contentId,
            ids: externalIds(details, { kinopoisk: "kinopoiskId", imdb: "imdbId" }),
            serial,
            title: text(details.title),
            variants: [{ url: url.href }],
          },
        ],
        query,
        lookup,
        normalizeProviderOutputUrl,
      );
    },
  };
}
