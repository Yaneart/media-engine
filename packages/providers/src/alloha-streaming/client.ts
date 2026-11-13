import type { StreamQuery } from "@media-engine/core";
import {
  embedError,
  externalIds,
  record,
  text,
  type EmbedClient,
  type EmbedLookup,
} from "../shared/keyed-embed.js";
import type { EmbedEpisode, EmbedRecord, EmbedVariant } from "../shared/embed-catalog.js";

// Alloha and Mirage expose the same documented legacy API shape on independent endpoints.
export async function loadAllohaCatalog(
  client: EmbedClient,
  lookup: EmbedLookup,
  _query: StreamQuery,
): Promise<EmbedRecord[]> {
  const payload = await client.request("/", {
    [lookup.source === "kinopoisk" ? "kp" : lookup.source]: lookup.id,
  });
  if (payload === null) return [];
  const root = record(payload);
  if (!root) return client.invalid();
  if (root.status === "error") {
    if (root.error_info === "not movie") return [];
    if (/token/iu.test(String(root.error_info))) {
      throw embedError(client.name, "PROVIDER_UNAUTHORIZED", "rejected the API credential");
    }
    return client.invalid();
  }
  const item = record(root.data);
  if (root.status !== "success" || !item || ![1, 2, 3, 4, 5, 6, 7].includes(Number(item.category)))
    return client.invalid();
  const episodes: EmbedEpisode[] = [];
  for (const [seasonKey, rawSeason] of Object.entries(record(item.seasons) ?? {}).slice(0, 100)) {
    const season = record(rawSeason);
    const seasonNumber = Number(season?.season ?? seasonKey);
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) continue;
    for (const [episodeKey, rawEpisode] of Object.entries(record(season?.episodes) ?? {}).slice(
      0,
      2000,
    )) {
      const episode = record(rawEpisode);
      const episodeNumber = Number(episode?.episode ?? episodeKey);
      if (!episode || !Number.isSafeInteger(episodeNumber) || episodeNumber < 1) continue;
      episodes.push({
        seasonNumber,
        episodeNumber,
        variants: allohaVariants(episode, episode.translation),
      });
    }
  }
  const ids = externalIds(item, { kinopoisk: "id_kp", imdb: "id_imdb", tmdb: "id_tmdb" });
  return [
    {
      id: text(item.token_movie) ?? lookup.id,
      ids,
      serial: [2, 4, 6, 7].includes(Number(item.category)),
      title: text(item.name),
      variants: allohaVariants(item, item.translation_iframe),
      episodes,
    },
  ];
}

function allohaVariants(item: Record<string, unknown>, translations: unknown): EmbedVariant[] {
  const main = text(item.iframe);
  return [
    ...(main ? [{ url: main, quality: text(item.quality) }] : []),
    ...Object.entries(record(translations) ?? {})
      .slice(0, 32)
      .flatMap(([id, raw]) => {
        const value = record(raw);
        const url = text(value?.iframe);
        return url
          ? [
              {
                id,
                url,
                translation: text(value?.name) ?? text(value?.translation),
                quality: text(value?.quality),
              },
            ]
          : [];
      }),
  ];
}
