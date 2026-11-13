import {
  createKeyedEmbedProvider,
  externalIds,
  record,
  text,
  type KeyedEmbedProviderOptions,
} from "../shared/keyed-embed.js";
import type { EmbedEpisode } from "../shared/embed-catalog.js";

export interface CollapsStreamingProviderOptions extends KeyedEmbedProviderOptions {}
export function collapsStreamingProvider(options: CollapsStreamingProviderOptions = {}) {
  return createKeyedEmbedProvider(options, {
    name: "collaps-streaming",
    label: "Collaps",
    baseUrl: "https://apicollaps.cc",
    // This API ignores tmdb_id. TMDB queries use Core's verified identity resolution instead.
    ids: ["kinopoisk", "imdb"],
    byEpisode: true,
    async load(client, lookup) {
      const payload = await client.request("/list", {
        [lookup.source === "kinopoisk" ? "kinopoisk_id" : "imdb_id"]: lookup.id.replace(/^tt/u, ""),
        limit: "64",
      });
      if (payload === null) return [];
      const root = record(payload);
      if (!root || !Array.isArray(root.results)) return client.invalid();
      return root.results.slice(0, 64).map((raw) => {
        const item = record(raw);
        if (
          !item ||
          !["film", "series", "anime-film", "anime-series", "cartoon", "cartoon-series"].includes(
            String(item.type),
          )
        )
          return client.invalid();
        const episodes: EmbedEpisode[] = [];
        for (const rawSeason of (Array.isArray(item.seasons) ? item.seasons : []).slice(0, 100)) {
          const season = record(rawSeason);
          const seasonNumber = Number(season?.season);
          if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) continue;
          for (const rawEpisode of (Array.isArray(season?.episodes) ? season.episodes : []).slice(
            0,
            2000,
          )) {
            const episode = record(rawEpisode);
            const episodeNumber = Number(episode?.episode);
            const url = text(episode?.iframe_url);
            if (url && Number.isSafeInteger(episodeNumber) && episodeNumber > 0)
              episodes.push({
                seasonNumber,
                episodeNumber,
                variants: [{ url, quality: text(item.quality) }],
              });
          }
        }
        const url = text(item.iframe_url);
        return {
          id: String(item.id),
          ids: externalIds(item, { kinopoisk: "kinopoisk_id", imdb: "imdb_id" }),
          serial: String(item.type).endsWith("series"),
          title: text(item.name),
          variants: url ? [{ url, quality: text(item.quality) }] : [],
          episodes,
        };
      });
    },
  });
}
