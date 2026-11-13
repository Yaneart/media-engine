import {
  createKeyedEmbedProvider,
  embedError,
  externalIds,
  record,
  text,
  type KeyedEmbedProviderOptions,
} from "../shared/keyed-embed.js";
import type { EmbedEpisode, EmbedVariant } from "../shared/embed-catalog.js";

export interface VideoSeedStreamingProviderOptions extends KeyedEmbedProviderOptions {}
export function videoSeedStreamingProvider(options: VideoSeedStreamingProviderOptions = {}) {
  return createKeyedEmbedProvider(options, {
    name: "videoseed-streaming",
    label: "VideoSeed",
    baseUrl: "https://api.videoseed.tv",
    ids: ["kinopoisk", "imdb", "tmdb"],
    byEpisode: true,
    async load(client, lookup) {
      const payload = await client.request("/apiv2.php", {
        item: "search",
        [lookup.source === "kinopoisk" ? "kp" : lookup.source]: lookup.id,
      });
      if (payload === null) return [];
      const root = record(payload);
      if (!root) return client.invalid();
      if (root.status === "error" && root.data === "no data") return [];
      if (root.status === "error" && /token|key/iu.test(String(root.data)))
        throw embedError(client.name, "PROVIDER_UNAUTHORIZED", "rejected the API credential");
      if (root.status !== "success" || !Array.isArray(root.data)) return client.invalid();
      return root.data.slice(0, 64).map((raw) => {
        const item = record(raw);
        if (!item || !["movie", "serial"].includes(String(item.type))) return client.invalid();
        const episodes: EmbedEpisode[] = [];
        for (const [seasonKey, rawSeason] of Object.entries(record(item.seasons) ?? {}).slice(
          0,
          100,
        )) {
          const season = record(rawSeason);
          const seasonNumber = Number(seasonKey);
          if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) continue;
          for (const [episodeKey, rawEpisode] of Object.entries(record(season?.videos) ?? {}).slice(
            0,
            2000,
          )) {
            const episode = record(rawEpisode);
            const episodeNumber = Number(episodeKey);
            if (episode && Number.isSafeInteger(episodeNumber) && episodeNumber > 0)
              episodes.push({ seasonNumber, episodeNumber, variants: variants(episode) });
          }
        }
        return {
          id: String(item.id),
          ids: externalIds(item, { kinopoisk: "id_kp", imdb: "id_imdb", tmdb: "id_tmdb" }),
          serial: item.type === "serial",
          title: text(item.name),
          variants: variants(item),
          episodes,
        };
      });
    },
  });
}
function variants(item: Record<string, unknown>): EmbedVariant[] {
  const main = text(item.iframe);
  return [
    ...(main ? [{ url: main }] : []),
    ...Object.values(record(item.translation_iframe) ?? {})
      .slice(0, 32)
      .flatMap((raw) => {
        const value = record(raw);
        const url = text(value?.iframe);
        return url
          ? [
              {
                url,
                id: text(value?.translations_id),
                translation: text(value?.short_name) ?? text(value?.name),
              },
            ]
          : [];
      }),
  ];
}
