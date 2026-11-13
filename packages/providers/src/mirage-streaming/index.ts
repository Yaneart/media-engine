import { createKeyedEmbedProvider, type KeyedEmbedProviderOptions } from "../shared/keyed-embed.js";
import { loadAllohaCatalog } from "../alloha-streaming/client.js";

export interface MirageStreamingProviderOptions extends KeyedEmbedProviderOptions {}
export function mirageStreamingProvider(options: MirageStreamingProviderOptions = {}) {
  return createKeyedEmbedProvider(options, {
    name: "mirage-streaming",
    label: "Mirage",
    baseUrl: "https://api.apbugall.org",
    ids: ["kinopoisk", "imdb", "tmdb"],
    byEpisode: true,
    load: loadAllohaCatalog,
  });
}
