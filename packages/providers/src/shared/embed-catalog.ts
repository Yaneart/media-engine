import type {
  ExternalIds,
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
  StreamQuery,
} from "@media-engine/core";
import { verifyAnimeEpisodeSelection } from "./anime-episode.js";
import type { EmbedLookup } from "./keyed-embed.js";

export interface EmbedVariant {
  url: string;
  id?: string;
  translation?: string;
  quality?: string;
}
export interface EmbedEpisode {
  seasonNumber: number;
  episodeNumber: number;
  variants: EmbedVariant[];
}
export interface EmbedRecord {
  id: string;
  ids: ExternalIds;
  serial: boolean;
  title?: string;
  variants: EmbedVariant[];
  episodes?: EmbedEpisode[];
}

export function mapEmbedCatalog(
  provider: string,
  label: string,
  records: EmbedRecord[],
  query: StreamQuery,
  lookup: EmbedLookup,
  safeUrl: (url: string) => string | undefined,
): MediaAvailability | null {
  const exact = query.episodeNumber !== undefined;
  const movie = query.type === "movie" || (query.type === "anime" && query.animeKind === "movie");
  const options: StreamOption[] = [];
  const episodes = new Map<string, StreamEpisodeAvailability>();
  let title: string | undefined;
  for (const item of records.slice(0, 64)) {
    if (item.ids[lookup.source] !== lookup.id || item.serial === movie) continue;
    // An exact endpoint is not enough if the upstream contradicts another supplied external ID.
    if (
      ["kinopoisk", "imdb", "tmdb"].some((source) => {
        const s = source as keyof ExternalIds;
        const expected = query.ids?.[s] ?? query[source as "kinopoisk" | "imdb" | "tmdb"];
        return expected && item.ids[s] && expected !== item.ids[s];
      })
    )
      continue;
    title ??= item.title;
    const catalog = item.episodes ?? [];
    let selected = { seasonNumber: query.seasonNumber, episodeNumber: query.episodeNumber };
    if (exact && query.type === "anime" && query.animeKind !== "movie") {
      const verified = verifyAnimeEpisodeSelection(query, catalog);
      if (!verified) continue;
      selected = verified;
    }
    const makeOptions = (variants: EmbedVariant[], episode?: EmbedEpisode): StreamOption[] => {
      const seen = new Set<string>();
      return variants.slice(0, 32).flatMap((variant, index) => {
        const url = safeUrl(variant.url);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [
          {
            id: `${provider}:${lookup.source}:${lookup.id}:${item.id}:${episode ? `${episode.seasonNumber}:${episode.episodeNumber}:` : ""}${variant.id ?? index}`,
            provider,
            player: { kind: "embed" as const, label, providerPlayerId: item.id },
            access: { url },
            sourceUrl: url,
            discovery: "direct" as const,
            availability: "unknown" as const,
            ...(variant.translation
              ? {
                  translation: {
                    id: variant.id,
                    title: variant.translation,
                    type: "unknown" as const,
                  },
                }
              : {}),
            ...(variant.quality ? { quality: { label: variant.quality } } : {}),
            ...(episode
              ? {
                  episode: {
                    seasonNumber: exact ? query.seasonNumber : episode.seasonNumber,
                    episodeNumber: exact ? query.episodeNumber : episode.episodeNumber,
                    ...(exact && query.absoluteEpisodeNumber !== undefined
                      ? { absoluteEpisodeNumber: query.absoluteEpisodeNumber }
                      : {}),
                  },
                }
              : {}),
          },
        ];
      });
    };
    if (!exact) options.push(...makeOptions(item.variants));
    for (const episode of catalog.slice(0, 2000)) {
      if (
        exact &&
        (episode.seasonNumber !== selected.seasonNumber ||
          episode.episodeNumber !== selected.episodeNumber)
      )
        continue;
      const mapped = makeOptions(episode.variants, episode);
      if (!mapped.length) continue;
      if (exact) options.push(...mapped);
      const seasonNumber = exact ? query.seasonNumber! : episode.seasonNumber;
      const episodeNumber = exact ? query.episodeNumber! : episode.episodeNumber;
      const key = `${seasonNumber}:${episodeNumber}`;
      const previous = episodes.get(key);
      episodes.set(key, {
        seasonNumber,
        episodeNumber,
        options: [...(previous?.options ?? []), ...mapped],
      });
    }
  }
  const unique = [...new Map(options.map((option) => [option.access.url, option])).values()].slice(
    0,
    64,
  );
  if (!unique.length) return null;
  const ids = { ...query.ids, [lookup.source]: lookup.id };
  return {
    query,
    item: { type: query.type, title: query.title ?? title, year: query.year, ids },
    options: unique,
    ...(episodes.size
      ? {
          episodes: [...episodes.values()].sort(
            (a, b) => a.seasonNumber! - b.seasonNumber! || a.episodeNumber! - b.episodeNumber!,
          ),
        }
      : {}),
    sourceProviders: [{ provider, url: unique[0]!.sourceUrl, ids }],
    checkedAt: new Date().toISOString(),
  };
}
