import {
  createKeyedEmbedProvider,
  externalIds,
  normalizeEmbedBaseUrl,
  record,
  text,
  type KeyedEmbedProviderOptions,
} from "../shared/keyed-embed.js";

export interface VibixStreamingProviderOptions extends KeyedEmbedProviderOptions {
  /** Public player origin used by Vibix's official Rendex SDK when iframe_url is empty. */
  playerBaseUrl?: string;
}
export function vibixStreamingProvider(options: VibixStreamingProviderOptions = {}) {
  const playerBaseUrl = normalizeEmbedBaseUrl(
    options.playerBaseUrl ?? "https://river-3-329.kinescopecdn.net",
  );
  return createKeyedEmbedProvider(options, {
    name: "vibix-streaming",
    label: "Vibix",
    baseUrl: "https://vibix.org",
    ids: ["kinopoisk", "imdb"],
    byEpisode: false,
    async load(client, lookup) {
      const payload = await client.request(
        `/api/v1/publisher/videos/${lookup.source === "kinopoisk" ? "kp" : "imdb"}/${lookup.id}`,
        {},
        true,
      );
      if (payload === null) return [];
      const item = record(payload);
      if (!item || !["movie", "serial"].includes(String(item.type))) return client.invalid();
      let url = text(item.iframe_url);
      if (!url) {
        const code = text(item.embed_code) ?? "";
        const attribute = (name: string) => {
          const matches = [...code.matchAll(new RegExp(`\\b${name}=["']([^"']+)["']`, "gu"))];
          return matches.length === 1 ? matches[0]![1] : undefined;
        };
        const publisherId = attribute("data-publisher-id");
        const id = attribute("data-id");
        const type = attribute("data-type");
        if (
          !publisherId ||
          !id ||
          !/^[1-9]\d{0,11}$/u.test(publisherId) ||
          !/^[1-9]\d{0,11}$/u.test(id) ||
          type !== item.type
        )
          return client.invalid();
        // embed_code data-id is the player ID; API item.id belongs to a different catalog.
        url = new URL(
          `/${publisherId}/${type === "serial" ? "embed-serials" : "embed"}/${id}`,
          playerBaseUrl,
        ).href;
      }
      return [
        {
          id: String(item.id),
          ids: externalIds(item, { kinopoisk: "kp_id", imdb: "imdb_id" }),
          serial: item.type === "serial",
          title: text(item.name),
          variants: [{ url, quality: text(item.quality) }],
        },
      ];
    },
  });
}
