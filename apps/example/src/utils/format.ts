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
  const groups = new Map<string, Map<string, Map<string, AvailabilityOption[]>>>();

  for (const option of options) {
    const groupLabel = [formatEpisodeRef(option), formatTranslationGroup(option)]
      .filter(Boolean)
      .join(" · ");
    const playerLabel = option.player.label;
    const variantKey = formatPlayerVariantKey(option);
    const playerGroups = groups.get(groupLabel) ?? new Map();
    const variants = playerGroups.get(playerLabel) ?? new Map();
    const variantOptions = variants.get(variantKey) ?? [];

    variantOptions.push(option);
    variants.set(variantKey, variantOptions);
    playerGroups.set(playerLabel, variants);
    groups.set(groupLabel, playerGroups);
  }

  return [...groups.entries()].map(([label, playerGroups]) => ({
    label,
    players: [...playerGroups.entries()].map(([playerLabel, variants]) => ({
      label: playerLabel,
      variants: [...variants.values()].map((variantOptions) => ({
        label: formatPlayerVariantLabel(variantOptions[0]!),
        options: variantOptions.toSorted(compareAvailabilityOptions),
      })),
    })),
  }));
}

export function formatPlayerMeta(option: AvailabilityOption): string {
  return [
    option.provider,
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

function formatTranslationGroup(option: AvailabilityOption): string {
  return formatTranslationTag(option) ?? "Other translations";
}

export interface AvailabilityOptionGroup {
  label: string;
  players: Array<{
    label: string;
    variants: Array<{
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

  return !translation || translation === option.player.label ? "Default" : translation;
}

function compareAvailabilityOptions(left: AvailabilityOption, right: AvailabilityOption): number {
  return (right.quality?.height ?? 0) - (left.quality?.height ?? 0);
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
