import { createKeyedEmbedProvider, type KeyedEmbedProviderOptions } from "../shared/keyed-embed.js";
import { loadAllohaCatalog } from "./client.js";

export interface AllohaStreamingProviderOptions extends KeyedEmbedProviderOptions {}
export function allohaStreamingProvider(options: AllohaStreamingProviderOptions = {}) {
  return createKeyedEmbedProvider(options, {
    name: "alloha-streaming",
    label: "Alloha",
    baseUrl: "https://api.alloha.tv",
    ids: ["kinopoisk", "imdb", "tmdb"],
    byEpisode: true,
    load: loadAllohaCatalog,
  });
}
