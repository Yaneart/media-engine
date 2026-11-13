import {
  createKeyedEmbedProvider,
  embedError,
  externalIds,
  record,
  text,
  type KeyedEmbedProviderOptions,
} from "../shared/keyed-embed.js";

export interface HdvbStreamingProviderOptions extends KeyedEmbedProviderOptions {}
export function hdvbStreamingProvider(options: HdvbStreamingProviderOptions = {}) {
  return createKeyedEmbedProvider(options, {
    name: "hdvb-streaming",
    label: "HDVB",
    baseUrl: "https://apivb.com",
    // The published API accepts id_kp, not id_tmdb/id_imdb.
    ids: ["kinopoisk"],
    byEpisode: false,
    async load(client, lookup) {
      const payload = await client.request("/api/videos.json", { id_kp: lookup.id });
      if (payload === null) return [];
      if (!Array.isArray(payload)) {
        const error = record(payload);
        if (error?.code === 1 || /token/iu.test(String(error?.text)))
          throw embedError(client.name, "PROVIDER_UNAUTHORIZED", "rejected the API credential");
        return client.invalid();
      }
      return payload.slice(0, 64).flatMap((raw) => {
        const item = record(raw);
        if (!item || !["movie", "serial"].includes(String(item.type))) return client.invalid();
        if (item.block === true || item.block === 1) return [];
        const url = text(item.iframe_url);
        return [
          {
            id: text(item.token) ?? lookup.id,
            ids: externalIds(item, { kinopoisk: "kinopoisk_id" }),
            serial: item.type === "serial",
            title: text(item.title_ru),
            variants: url
              ? [
                  {
                    url,
                    id: String(item.translator_id),
                    translation: text(item.translator),
                    quality: text(item.quality),
                  },
                ]
              : [],
          },
        ];
      });
    },
  });
}
