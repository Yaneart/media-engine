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
  if (!status || status === "unknown") return undefined;

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCount(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export function formatCountedLabel(label: string, count: number): string {
  return count > 1 ? `${label} (${count})` : label;
}

export function getAvailabilityOptions(state: AvailabilityState): AvailabilityOption[] {
  return state.status === "success" || state.status === "empty" ? state.response.options : [];
}

export function getPrimaryPlayerOptions(state: AvailabilityState): AvailabilityOption[] {
  if (state.status !== "success" && state.status !== "empty") return [];

  return state.response.options.filter(
    (option) =>
      (option.player.kind === "hls" || option.player.kind === "mp4") &&
      matchesEpisodeQuery(option, state.response.query),
  );
}

export function getEmbedPlayerOptions(state: AvailabilityState): AvailabilityOption[] {
  return getAvailabilityOptions(state).filter(
    (option) => option.player.kind === "embed" || option.player.kind === "external",
  );
}

export interface PrimaryPlayerSourceGroup {
  key: string;
  label: string;
  voices: PrimaryPlayerVoiceGroup[];
}

export interface PrimaryPlayerVoiceGroup {
  key: string;
  label: string;
  options: AvailabilityOption[];
}

export function groupPrimaryPlayerOptions(
  options: AvailabilityOption[],
): PrimaryPlayerSourceGroup[] {
  const sources = new Map<string, AvailabilityOption[]>();

  for (const option of options) {
    const sourceKey = [
      option.provider,
      option.player.kind,
      normalizeLabel(option.player.label),
    ].join("\u0000");
    sources.set(sourceKey, [...(sources.get(sourceKey) ?? []), option]);
  }

  return [...sources.entries()]
    .map(([key, sourceOptions]) => ({
      key,
      label: formatPrimarySourceLabel(sourceOptions[0]!),
      voices: groupVoiceoverOptions(sourceOptions),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "ru"));
}

export interface EmbedPlayerGroup {
  key: string;
  label: string;
  providerLabel: string;
  option: AvailabilityOption;
}

export function groupEmbedPlayers(options: AvailabilityOption[]): EmbedPlayerGroup[] {
  const groups = new Map<string, AvailabilityOption[]>();

  for (const option of options.filter(
    (candidate) => candidate.player.kind === "embed" || candidate.player.kind === "external",
  )) {
    const key = normalizeLabel(option.player.label);
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  return [...groups.entries()]
    .map(([key, playerOptions]) => {
      const option = playerOptions.toSorted(compareEmbedOptions)[0]!;
      return {
        key,
        label: formatPlayerLabel(option.player.label),
        providerLabel: formatProviderLabel(option.provider),
        option,
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label, "ru"));
}

export function hasExactEpisodeQuery(
  query: AvailabilityResponse["query"],
  type: MediaDetails["type"],
): boolean {
  if (type === "anime") return isPositiveInteger(query.absoluteEpisodeNumber);
  if (type === "series") {
    return isPositiveInteger(query.seasonNumber) && isPositiveInteger(query.episodeNumber);
  }
  return true;
}

export function formatPlayerMeta(option: AvailabilityOption): string {
  const kind = option.player.kind === "hls" ? "HLS" : "MP4";
  const status =
    option.availability === "available"
      ? "доступен"
      : option.availability === "unknown"
        ? "не проверен"
        : option.availability.replaceAll("_", " ");

  return `${formatProviderLabel(option.provider)} · ${kind} · ${status}`;
}

export function formatQualityLabel(option: AvailabilityOption): string {
  return option.quality?.label?.trim() || "Авто";
}

export function formatProviderFailure(
  failure: NonNullable<AvailabilityResponse["meta"]>["providers"]["failed"][number],
): string {
  return `${formatProviderLabel(failure.provider)}: ${failure.message}`;
}

export function getEpisodesCount(details: MediaDetails): number | undefined {
  return "episodesCount" in details ? details.episodesCount : undefined;
}

export function formatPlayerLabel(value: string): string {
  const knownLabels: Record<string, string> = {
    alloha: "Alloha",
    collaps: "Collaps",
    flixcdn: "FlixCDN",
    hdvb: "HDVB",
    kodik: "Kodik",
    rutube: "Rutube",
    veoveo: "VeoVeo",
    videohub: "VideoHUB",
    vibix: "Vibix",
  };

  return knownLabels[normalizeLabel(value)] ?? value.trim();
}

export function formatProviderLabel(value: string): string {
  const knownLabels: Record<string, string> = {
    "aniliberty-streaming": "AniLiberty",
    "ddbb-streaming": "DDBB",
    "flixhq-streaming": "FlixHQ",
    "filmix-streaming": "Filmix",
    "kinobd-streaming": "KinoBD",
    "rutube-streaming": "Rutube",
    "veoveo-streaming": "VeoVeo",
    "videohub-streaming": "VideoHUB",
  };

  return knownLabels[value] ?? value;
}

function groupVoiceoverOptions(options: AvailabilityOption[]): PrimaryPlayerVoiceGroup[] {
  const voices = new Map<string, AvailabilityOption[]>();

  for (const option of options) {
    const key = [
      normalizeLabel(option.translation?.id ?? ""),
      normalizeLabel(option.translation?.title ?? ""),
      normalizeLabel(option.translation?.team ?? ""),
      formatEpisodeRef(option) ?? "",
    ].join("\u0000");
    voices.set(key, [...(voices.get(key) ?? []), option]);
  }

  return [...voices.entries()]
    .map(([key, voiceOptions]) => ({
      key,
      label: formatVoiceoverLabel(voiceOptions[0]!),
      options: deduplicateQualities(voiceOptions).toSorted(compareAvailabilityOptions),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "ru"));
}

function formatPrimarySourceLabel(option: AvailabilityOption): string {
  const provider = formatProviderLabel(option.provider);
  const player = formatPlayerLabel(option.player.label);
  return normalizeLabel(provider) === normalizeLabel(player) ? player : `${player} — ${provider}`;
}

function formatVoiceoverLabel(option: AvailabilityOption): string {
  const voiceover = option.translation?.title?.trim() || option.translation?.team?.trim();
  const source = formatProviderLabel(option.provider);
  const player = formatPlayerLabel(option.player.label);

  return !voiceover ||
    normalizeLabel(voiceover) === "default" ||
    [source, player].some((label) => normalizeLabel(label) === normalizeLabel(voiceover))
    ? "Встроенная дорожка"
    : voiceover;
}

function deduplicateQualities(options: AvailabilityOption[]): AvailabilityOption[] {
  const byQuality = new Map<string, AvailabilityOption>();

  for (const option of options) {
    const key = `${option.quality?.height ?? ""}:${normalizeLabel(formatQualityLabel(option))}`;
    const existing = byQuality.get(key);
    if (!existing || availabilityRank(option) > availabilityRank(existing)) {
      byQuality.set(key, option);
    }
  }

  return [...byQuality.values()];
}

function compareAvailabilityOptions(left: AvailabilityOption, right: AvailabilityOption): number {
  return (
    (right.quality?.height ?? 0) - (left.quality?.height ?? 0) ||
    availabilityRank(right) - availabilityRank(left)
  );
}

function compareEmbedOptions(left: AvailabilityOption, right: AvailabilityOption): number {
  return (
    availabilityRank(right) - availabilityRank(left) ||
    Number(right.player.kind === "embed") - Number(left.player.kind === "embed")
  );
}

function availabilityRank(option: AvailabilityOption): number {
  if (option.availability === "available") return 2;
  if (option.availability === "unknown") return 1;
  return 0;
}

function matchesEpisodeQuery(
  option: AvailabilityOption,
  query: AvailabilityResponse["query"],
): boolean {
  const episode = option.episode;
  if (!episode) return true;

  if (
    query.absoluteEpisodeNumber !== undefined &&
    episode.absoluteEpisodeNumber !== undefined &&
    query.absoluteEpisodeNumber !== episode.absoluteEpisodeNumber
  ) {
    return false;
  }

  if (
    query.seasonNumber !== undefined &&
    episode.seasonNumber !== undefined &&
    query.seasonNumber !== episode.seasonNumber
  ) {
    return false;
  }

  return !(
    query.episodeNumber !== undefined &&
    episode.episodeNumber !== undefined &&
    query.episodeNumber !== episode.episodeNumber
  );
}

function formatEpisodeRef(option: AvailabilityOption): string | undefined {
  if (!option.episode) return undefined;
  if (option.episode.seasonNumber !== undefined || option.episode.episodeNumber !== undefined) {
    return `S${option.episode.seasonNumber ?? "?"}E${option.episode.episodeNumber ?? "?"}`;
  }
  return option.episode.absoluteEpisodeNumber === undefined
    ? undefined
    : `E${option.episode.absoluteEpisodeNumber}`;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function isPositiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? 0) > 0;
}
