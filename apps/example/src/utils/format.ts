import type { AvailabilityResponse, MediaDetails, MediaSummary } from "../api";
import type { AvailabilityOption, AvailabilityState } from "../state";

export function hasDetailsLookup(item: MediaSummary): boolean {
  return Boolean(item.ids && Object.values(item.ids).some((value) => Boolean(value)));
}

export function formatMediaMeta(item: MediaSummary): string {
  return [item.type, item.year].filter(Boolean).join(" · ");
}

export function formatRating(ratings: MediaSummary["ratings"]): string {
  const rating = ratings?.[0];

  return rating ? `${rating.value}/${rating.max} ${rating.source}` : "No rating";
}

export function formatRuntime(runtimeMinutes: number | undefined): string | undefined {
  return runtimeMinutes ? `${runtimeMinutes} min` : undefined;
}

export function formatStatus(status: MediaDetails["status"]): string | undefined {
  if (!status || status === "unknown") {
    return undefined;
  }

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCount(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export function getAvailabilityOptions(state: AvailabilityState): AvailabilityOption[] {
  return state.status === "success" || state.status === "empty" ? state.response.options : [];
}

export function groupAvailabilityOptions(options: AvailabilityOption[]): AvailabilityOptionGroup[] {
  const groups = new Map<
    string,
    {
      label: string;
      players: Map<string, { label: string; variants: Map<string, AvailabilityOption[]> }>;
    }
  >();

  for (const option of options) {
    const episodeLabel = formatEpisodeRef(option);
    const groupKey = episodeLabel ?? "general";
    const playerKey = normalizePlayerLabel(option.player.label);
    const variantKey = formatPlayerVariantKey(option);
    const group = groups.get(groupKey) ?? {
      label: episodeLabel ?? "General players",
      players: new Map(),
    };
    const player = group.players.get(playerKey) ?? {
      label: formatPlayerLabel(option.player.label),
      variants: new Map(),
    };
    const variants = player.variants;
    const variantOptions = variants.get(variantKey) ?? [];

    variantOptions.push(option);
    variants.set(variantKey, variantOptions);
    group.players.set(playerKey, player);
    groups.set(groupKey, group);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    players: [...group.players.entries()].map(([playerKey, player]) => ({
      key: playerKey,
      label: player.label,
      variants: [...player.variants.entries()].map(([variantKey, variantOptions]) => ({
        key: variantKey,
        label: formatPlayerVariantLabel(variantOptions[0]!),
        options: variantOptions.toSorted(compareAvailabilityOptions),
      })),
    })),
  }));
}

export function formatPlayerMeta(option: AvailabilityOption): string {
  return [
    formatTranslationTag(option),
    option.player.kind,
    option.availability === "available" ? undefined : option.availability.replaceAll("_", " "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatQualityLabel(option: AvailabilityOption): string {
  return option.quality?.label ?? "Default";
}

export function formatProviderFailure(
  failure: NonNullable<AvailabilityResponse["meta"]>["providers"]["failed"][number],
): string {
  return `${failure.provider}: ${failure.message}`;
}

// EN: Read episode counters only from media detail variants that can expose them.
// RU: Читает счетчики эпизодов только из вариантов media details, где они возможны.
export function getEpisodesCount(details: MediaDetails): number | undefined {
  return "episodesCount" in details ? details.episodesCount : undefined;
}

export interface AvailabilityOptionGroup {
  key: string;
  label: string;
  players: Array<{
    key: string;
    label: string;
    variants: Array<{
      key: string;
      label: string;
      options: AvailabilityOption[];
    }>;
  }>;
}

function formatPlayerVariantKey(option: AvailabilityOption): string {
  return [
    option.provider,
    option.player.providerPlayerId,
    option.translation?.id,
    option.translation?.title,
    option.translation?.team,
    formatEpisodeRef(option),
  ].join("\u0000");
}

function formatPlayerVariantLabel(option: AvailabilityOption): string {
  const translation = option.translation?.title?.trim();

  return !translation ||
    normalizePlayerLabel(translation) === normalizePlayerLabel(option.player.label)
    ? `Default · ${formatProviderLabel(option.provider)}`
    : `${translation} · ${formatProviderLabel(option.provider)}`;
}

function compareAvailabilityOptions(left: AvailabilityOption, right: AvailabilityOption): number {
  return (right.quality?.height ?? 0) - (left.quality?.height ?? 0);
}

function normalizePlayerLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function formatPlayerLabel(value: string): string {
  const knownLabels: Record<string, string> = {
    alloha: "Alloha",
    collaps: "Collaps",
    flixcdn: "FlixCDN",
    hdvb: "HDVB",
    kodik: "Kodik",
    veoveo: "Veoveo",
    vibix: "Vibix",
  };

  return knownLabels[normalizePlayerLabel(value)] ?? value.trim();
}

function formatProviderLabel(value: string): string {
  const knownLabels: Record<string, string> = {
    "aniliberty-streaming": "AniLiberty",
    "ddbb-streaming": "DDBB",
    "flixhq-streaming": "FlixHQ",
    "kinobd-streaming": "KinoBD",
  };

  return knownLabels[value] ?? value;
}

function formatTranslationTag(option: AvailabilityOption): string | undefined {
  const language = formatLanguageLabel(option.translation?.language);
  const type =
    option.translation?.type && option.translation.type !== "unknown"
      ? formatTranslationType(option.translation.type)
      : undefined;

  return [language, type].filter(Boolean).join(" ") || undefined;
}

function formatLanguageLabel(language: string | undefined): string | undefined {
  switch (language) {
    case "ru":
      return "Russian";
    case "uk":
      return "Ukrainian";
    case "en":
      return "English";
    default:
      return language?.toUpperCase();
  }
}

function formatTranslationType(type: string): string {
  switch (type) {
    case "dub":
      return "Dub";
    case "voiceover":
      return "Voiceover";
    case "subtitles":
      return "Subtitles";
    case "original":
      return "Original";
    default:
      return type;
  }
}

function formatEpisodeRef(option: AvailabilityOption): string | undefined {
  if (!option.episode) {
    return undefined;
  }

  if (option.episode.seasonNumber !== undefined || option.episode.episodeNumber !== undefined) {
    return `S${option.episode.seasonNumber ?? "?"}E${option.episode.episodeNumber ?? "?"}`;
  }

  return option.episode.absoluteEpisodeNumber === undefined
    ? undefined
    : `Episode ${option.episode.absoluteEpisodeNumber}`;
}
