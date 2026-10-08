import type {
  ExternalIds,
  MediaAvailability,
  StreamOption,
  TranslationInfo,
} from "@media-engine/core";
import {
  resolveAnimeEpisodeSelection,
  verifyAnimeEpisodeSelection,
} from "../shared/anime-episode.js";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import type { KodikResult } from "./client.js";

const MOVIE_TYPES = new Set([
  "foreign-movie",
  "russian-movie",
  "soviet-cartoon",
  "foreign-cartoon",
]);
const SERIES_TYPES = new Set([
  "foreign-serial",
  "russian-serial",
  "cartoon-serial",
  "documentary-serial",
]);

export function mapKodikAvailability(
  provider: string,
  results: KodikResult[],
  query: MediaAvailability["query"],
  sourceUrl: string,
  now: number,
): MediaAvailability | null {
  const matching = results.filter((result) => matchesQuery(result, query));
  const options = uniqueOptions(
    matching.flatMap((result) => {
      const selected = selectAccess(result, query);
      return selected ? [createOption(provider, result, selected, query)] : [];
    }),
  );
  if (options.length === 0) return null;

  const first = matching[0]!;
  const ids = collectIds(first);
  const episode = options[0]?.episode;
  return {
    query,
    item: {
      type: query.type,
      title: first.title,
      ...(first.originalTitle ? { originalTitle: first.originalTitle } : {}),
      ...(first.year !== undefined ? { year: first.year } : {}),
      ids,
    },
    ...(episode ? { episodes: [{ ...episode, options }] } : {}),
    options,
    sourceProviders: [{ provider, url: sourceUrl, ids }],
    checkedAt: new Date(now).toISOString(),
  };
}

function matchesQuery(result: KodikResult, query: MediaAvailability["query"]): boolean {
  if (!matchesType(result.type, query)) return false;
  const expected = {
    kinopoisk: query.ids?.kinopoisk ?? query.kinopoisk,
    imdb: query.ids?.imdb ?? query.imdb,
    shikimori: query.ids?.shikimori ?? query.shikimori,
  };
  const actual = {
    kinopoisk: result.kinopoiskId,
    imdb: result.imdbId,
    shikimori: result.shikimoriId,
  };
  const comparable = Object.entries(expected).filter(([, value]) => value !== undefined);
  const observed = comparable.filter(([key]) => actual[key as keyof typeof actual] !== undefined);
  return (
    observed.length > 0 &&
    observed.every(([key, value]) => actual[key as keyof typeof actual] === value)
  );
}

function matchesType(type: string, query: MediaAvailability["query"]): boolean {
  if (query.type === "movie") return MOVIE_TYPES.has(type);
  if (query.type === "series") return SERIES_TYPES.has(type);
  if (query.animeKind === "movie") return type === "anime";
  return query.animeKind === "tv" && type === "anime-serial";
}

function selectAccess(
  result: KodikResult,
  query: MediaAvailability["query"],
): { url: string; providerSeason?: number } | undefined {
  const isFilm = query.type === "movie" || (query.type === "anime" && query.animeKind === "movie");
  if (isFilm) return normalizeLink(result.link);

  const hasSeason = query.seasonNumber !== undefined;
  const hasEpisode = query.episodeNumber !== undefined;
  if (query.type === "series") {
    if (!hasSeason && !hasEpisode && query.absoluteEpisodeNumber === undefined) {
      return normalizeLink(result.link);
    }
    if (!hasSeason || !hasEpisode || query.absoluteEpisodeNumber !== undefined) return undefined;
    return selectEpisode(result, query.seasonNumber!, query.episodeNumber!);
  }

  const catalog = Object.entries(result.seasons).flatMap(([seasonNumber, season]) =>
    Object.keys(season.episodes).map((episodeNumber) => ({
      seasonNumber: Number(seasonNumber),
      episodeNumber: Number(episodeNumber),
    })),
  );
  const selection =
    verifyAnimeEpisodeSelection(query, catalog) ?? resolveReleaseLocalEpisode(result, query);
  return selection
    ? selectEpisode(result, selection.seasonNumber, selection.episodeNumber)
    : undefined;
}

function resolveReleaseLocalEpisode(
  result: KodikResult,
  query: MediaAvailability["query"],
): { seasonNumber: number; episodeNumber: number } | undefined {
  const selection = resolveAnimeEpisodeSelection(query);
  const release = query.animeReleaseEpisode;
  if (!selection?.releaseEpisodeNumber || !release) return undefined;

  const expectedCount = release.releaseEpisodeCounts[release.releaseIndex];
  const candidates = Object.entries(result.seasons).filter(([, season]) => {
    const episodes = Object.keys(season.episodes).map(Number);
    return (
      episodes.length === expectedCount &&
      episodes.every((episodeNumber, index) => episodeNumber === index + 1) &&
      season.episodes[selection.releaseEpisodeNumber!] !== undefined
    );
  });
  return candidates.length === 1
    ? {
        seasonNumber: Number(candidates[0]![0]),
        episodeNumber: selection.releaseEpisodeNumber,
      }
    : undefined;
}

function selectEpisode(
  result: KodikResult,
  seasonNumber: number,
  episodeNumber: number,
): { url: string; providerSeason: number } | undefined {
  const link = result.seasons[seasonNumber]?.episodes[episodeNumber];
  const normalized = normalizeLink(link);
  return normalized ? { ...normalized, providerSeason: seasonNumber } : undefined;
}

function normalizeLink(value: string | undefined): { url: string } | undefined {
  const normalized = normalizeProviderOutputUrl(value?.startsWith("//") ? `https:${value}` : value);
  return normalized ? { url: normalized } : undefined;
}

function createOption(
  provider: string,
  result: KodikResult,
  selected: { url: string; providerSeason?: number },
  query: MediaAvailability["query"],
): StreamOption {
  const episode = createEpisodeRef(query);
  const quality = result.quality?.trim();
  const heightMatch = quality?.match(/(?:^|\D)(\d{3,4})p(?:\D|$)/iu);
  const availability =
    result.blockedCountries.length > 0
      ? "region_locked"
      : selected.providerSeason !== undefined && result.blockedSeasons.has(selected.providerSeason)
        ? "temporarily_unavailable"
        : "available";
  const episodeKey = episode
    ? `:s${episode.seasonNumber ?? ""}:e${episode.episodeNumber ?? ""}:a${episode.absoluteEpisodeNumber ?? ""}`
    : "";

  return {
    id: `${provider}:${result.id}${episodeKey}`,
    provider,
    discovery: "direct",
    player: { kind: "embed", label: "Kodik", provider: "kodik", providerPlayerId: result.id },
    translation: mapTranslation(result.translation),
    ...(quality
      ? {
          quality: {
            label: quality,
            ...(heightMatch ? { height: Number(heightMatch[1]) } : {}),
          },
        }
      : {}),
    ...(episode ? { episode } : {}),
    access: { url: selected.url },
    availability,
    sourceUrl: selected.url,
  };
}

function createEpisodeRef(query: MediaAvailability["query"]): StreamOption["episode"] {
  if (query.episodeNumber === undefined) return undefined;
  return {
    ...(query.seasonNumber !== undefined ? { seasonNumber: query.seasonNumber } : {}),
    episodeNumber: query.episodeNumber,
    ...(query.type === "anime" && query.absoluteEpisodeNumber !== undefined
      ? { absoluteEpisodeNumber: query.absoluteEpisodeNumber }
      : {}),
  };
}

function mapTranslation(translation: KodikResult["translation"]): TranslationInfo {
  const normalized = translation.type?.toLowerCase();
  return {
    ...(translation.id ? { id: translation.id } : {}),
    title: translation.title,
    type:
      normalized === "subtitles" ? "subtitles" : normalized === "voice" ? "voiceover" : "unknown",
    language: "ru",
    team: translation.title,
  };
}

function collectIds(result: KodikResult): ExternalIds {
  return {
    ...(result.kinopoiskId ? { kinopoisk: result.kinopoiskId } : {}),
    ...(result.imdbId ? { imdb: result.imdbId } : {}),
    ...(result.shikimoriId ? { shikimori: result.shikimoriId } : {}),
  };
}

function uniqueOptions(options: StreamOption[]): StreamOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.access.url}\u0000${option.translation?.id ?? option.translation?.title ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
