import { ProviderError, type MediaAvailability, type ProviderContext } from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl } from "../shared/index.js";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import type { VideoHubStreamingConfig } from "./config.js";

const PLAYLIST_PUBLICATION_ID = "12";
const MAX_TITLE_LENGTH = 500;
const MAX_TRANSLATION_LENGTH = 200;

const MP4_SOURCE_FIELDS = [
  { key: "mpeg4kUrl", label: "4K", height: 2160 },
  { key: "mpeg2kUrl", label: "2K" },
  { key: "mpegQhdUrl", label: "1440p", height: 1440 },
  { key: "mpegFullHdUrl", label: "1080p", height: 1080 },
  { key: "mpegHighUrl", label: "720p", height: 720 },
  { key: "mpegMediumUrl", label: "480p", height: 480 },
  { key: "mpegLowUrl", label: "360p", height: 360 },
  { key: "mpegLowestUrl", label: "240p", height: 240 },
  { key: "mpegTinyUrl", label: "144p", height: 144 },
] as const;

export interface VideoHubPlaylistItem {
  vkId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  voiceStudio?: string;
  voiceType?: string;
}

export interface VideoHubPlaylist {
  title?: string;
  isSerial: boolean;
  items: VideoHubPlaylistItem[];
}

export interface VideoHubMp4Source {
  url: string;
  label: string;
  height?: number;
}

export interface ResolvedVideoHubItem extends VideoHubPlaylistItem {
  sources: VideoHubMp4Source[];
  sourceUrl: string;
}

export function resolveVideoHubKinopoiskId(query: MediaAvailability["query"]): string | undefined {
  const kinopoisk = query.ids?.kinopoisk ?? query.kinopoisk;
  return kinopoisk && /^[1-9]\d{0,11}$/u.test(kinopoisk) ? kinopoisk : undefined;
}

export async function loadVideoHubPlaylist(
  config: VideoHubStreamingConfig,
  kinopoiskId: string,
  context: ProviderContext,
  playbackUserAgent: string,
): Promise<{ playlist: VideoHubPlaylist; sourceUrl: string }> {
  const url = createVideoHubPlaylistUrl(config.baseUrl, kinopoiskId);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxRetries: 0,
    maxResponseBytes: config.maxPlaylistResponseBytes,
    init: { headers: createHeaders(playbackUserAgent) },
  });

  return {
    playlist: parseVideoHubPlaylist(config.name, payload, config.playlistItemLimit),
    sourceUrl: url.href,
  };
}

function createVideoLookupContext(
  config: VideoHubStreamingConfig,
  context: ProviderContext,
): ProviderContext {
  return {
    ...context,
    timeoutMs:
      context.timeoutMs === undefined
        ? config.videoLookupTimeoutMs
        : Math.min(context.timeoutMs, config.videoLookupTimeoutMs),
  };
}

export async function resolveVideoHubItems(
  config: VideoHubStreamingConfig,
  playlist: VideoHubPlaylist,
  query: MediaAvailability["query"],
  context: ProviderContext,
  playbackUserAgent: string,
): Promise<ResolvedVideoHubItem[]> {
  const selected = selectPlaylistItems(playlist, query).slice(0, config.videoLookupLimit);
  if (selected.length === 0) return [];

  const resolved: Array<ResolvedVideoHubItem | undefined> = new Array(selected.length);
  let nextIndex = 0;
  let firstError: unknown;

  const worker = async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = selected[index]!;

      try {
        const result = await loadVideoHubSources(config, item.vkId, context, playbackUserAgent);
        if (result.sources.length > 0) resolved[index] = { ...item, ...result };
      } catch (error) {
        rethrowIfProviderAborted(context, error);
        firstError ??= error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(config.videoLookupConcurrency, selected.length) }, async () =>
      worker(),
    ),
  );

  const available = resolved.filter((item) => item !== undefined);
  if (available.length === 0 && firstError !== undefined) throw firstError;
  return available;
}

export function createVideoHubPlaylistUrl(baseUrl: string, kinopoiskId: string): URL {
  const url = new URL("/api/v1/player/sv/playlist", `${baseUrl}/`);
  url.searchParams.set("pub", PLAYLIST_PUBLICATION_ID);
  url.searchParams.set("aggr", "kp");
  url.searchParams.set("id", kinopoiskId);
  return url;
}

export function createVideoHubVideoUrl(baseUrl: string, vkId: string): URL {
  return new URL(`/api/v1/player/sv/video/${vkId}`, `${baseUrl}/`);
}

export function parseVideoHubPlaylist(
  provider: string,
  value: unknown,
  itemLimit: number,
): VideoHubPlaylist {
  if (!isRecord(value) || typeof value.isSerial !== "boolean" || !Array.isArray(value.items)) {
    throw invalidResponse(provider, "playlist");
  }

  const isSerial = value.isSerial;
  const items = value.items.slice(0, itemLimit).flatMap((entry) => {
    const item = parsePlaylistItem(entry, isSerial);
    return item ? [item] : [];
  });
  if (value.items.length > 0 && items.length === 0) throw invalidResponse(provider, "playlist");

  const title = readString(value.titleName, MAX_TITLE_LENGTH);
  return {
    ...(title ? { title } : {}),
    isSerial,
    items,
  };
}

export function parseVideoHubSources(provider: string, value: unknown): VideoHubMp4Source[] {
  if (!isRecord(value) || !isRecord(value.sources)) throw invalidResponse(provider, "video");

  const sources: VideoHubMp4Source[] = [];
  const seenUrls = new Set<string>();
  for (const field of MP4_SOURCE_FIELDS) {
    const rawUrl = value.sources[field.key];
    if (typeof rawUrl !== "string") continue;
    const url = normalizeHttpsOutputUrl(rawUrl);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    sources.push({
      url,
      label: field.label,
      ...("height" in field ? { height: field.height } : {}),
    });
  }

  return sources;
}

function selectPlaylistItems(
  playlist: VideoHubPlaylist,
  query: MediaAvailability["query"],
): VideoHubPlaylistItem[] {
  if (query.type === "movie") return playlist.isSerial ? [] : playlist.items;
  if (!playlist.isSerial) return [];

  return playlist.items.filter(
    (item) =>
      item.seasonNumber === query.seasonNumber && item.episodeNumber === query.episodeNumber,
  );
}

async function loadVideoHubSources(
  config: VideoHubStreamingConfig,
  vkId: string,
  context: ProviderContext,
  playbackUserAgent: string,
): Promise<{ sources: VideoHubMp4Source[]; sourceUrl: string }> {
  const url = createVideoHubVideoUrl(config.baseUrl, vkId);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context: createVideoLookupContext(config, context),
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxRetries: 0,
    maxResponseBytes: config.maxVideoResponseBytes,
    init: { headers: createHeaders(playbackUserAgent) },
  });

  return {
    sources: parseVideoHubSources(config.name, payload),
    sourceUrl: url.href,
  };
}

function parsePlaylistItem(value: unknown, isSerial: boolean): VideoHubPlaylistItem | undefined {
  if (!isRecord(value)) return undefined;
  const vkId = readIdentifier(value.vkId);
  if (!vkId) return undefined;

  const seasonNumber = isSerial ? readPositiveInteger(value.season) : undefined;
  const episodeNumber = isSerial ? readPositiveInteger(value.episode) : undefined;
  if (isSerial && (seasonNumber === undefined || episodeNumber === undefined)) return undefined;

  const voiceStudio = readString(value.voiceStudio, MAX_TRANSLATION_LENGTH);
  const voiceType = readString(value.voiceType, MAX_TRANSLATION_LENGTH);
  return {
    vkId,
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(voiceStudio ? { voiceStudio } : {}),
    ...(voiceType ? { voiceType } : {}),
  };
}

function createHeaders(userAgent: string): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
}

function normalizeHttpsOutputUrl(value: string): string | undefined {
  const normalized = normalizeProviderOutputUrl(value.trim());
  if (!normalized) return undefined;
  return new URL(normalized).protocol === "https:" ? normalized : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9]\d{0,19}$/u.test(value.trim())
    ? value.trim()
    : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(provider: string, stage: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid VideoHUB ${stage} response.`,
    retryable: false,
  });
}
