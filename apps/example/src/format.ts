import type { AvailabilityResponse, MediaDetails, MediaSummary } from "./api";
import type { AvailabilityOption, AvailabilityState } from "./state";

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

export function groupAvailabilityOptions(
  options: AvailabilityOption[],
): Array<{ label: string; options: AvailabilityOption[] }> {
  const groups = new Map<string, AvailabilityOption[]>();

  for (const option of options) {
    const label = formatTranslationGroup(option);
    const group = groups.get(label);

    if (group) {
      group.push(option);
    } else {
      groups.set(label, [option]);
    }
  }

  return [...groups.entries()].map(([label, groupOptions]) => ({
    label,
    options: groupOptions,
  }));
}

export function formatPlayerMeta(option: AvailabilityOption): string {
  return [
    option.player.kind,
    formatTranslationTag(option),
    option.translation?.title,
    option.quality?.label,
    formatEpisodeRef(option),
  ]
    .filter(Boolean)
    .join(" · ");
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
