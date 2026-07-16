import type {
  MediaAvailability,
  ProviderContext,
  StreamEpisodeRef,
  StreamOption,
  StreamingProvider,
  StreamingProviderCapabilities,
  SubtitleTrack,
} from "@media-engine/core";
import {
  mapProviderHttpError,
  normalizePublicHttpUrl,
  type ProviderFetch,
} from "../shared/index.js";
import { rethrowIfProviderAborted } from "../shared/abort.js";

const DEFAULT_BASE_URL = "https://flixhq.one";
const DEFAULT_PROVIDER_NAME = "flixhq-streaming";
const DEFAULT_MAX_HTML_BYTES = 1024 * 1024;
const DEFAULT_PLAYER_LIMIT = 8;
const DEFAULT_PLAYER_VALIDATION_CONCURRENCY = 3;
const DEFAULT_PLAYER_VALIDATION_TIMEOUT_MS = 2_500;
const DEFAULT_PLAYER_VALIDATION_MAX_BYTES = 256 * 1024;
const DEFAULT_SUBTITLE_INFO_MAX_BYTES = 256 * 1024;
const SUBTITLE_TRACK_LIMIT = 64;

export interface FlixHqStreamingProviderOptions {
  baseUrl?: string;
  name?: string;
  version?: string;
  fetch?: ProviderFetch;
  maxHtmlBytes?: number;
  playerLimit?: number;
  playerValidationConcurrency?: number;
  playerValidationTimeoutMs?: number;
  playerValidationMaxBytes?: number;
  subtitleInfoMaxBytes?: number;
  userAgent?: string;
}

interface FlixHqConfig {
  baseUrl: string;
  name: string;
  fetch?: ProviderFetch;
  maxHtmlBytes: number;
  playerLimit: number;
  playerValidationConcurrency: number;
  playerValidationTimeoutMs: number;
  playerValidationMaxBytes: number;
  subtitleInfoMaxBytes: number;
  userAgent: string;
}

interface SearchCandidate {
  mediaUrl: string;
  title: string;
  year?: number;
  type: "movie" | "series";
}

interface EpisodeCandidate extends StreamEpisodeRef {
  url: string;
  title?: string;
}

interface PlayerResponse {
  name?: string | null;
  link?: string | null;
}

interface SubtitleInfoEntry {
  file?: unknown;
  label?: unknown;
  kind?: unknown;
  default?: unknown;
}

export function flixHqStreamingProvider(
  options: FlixHqStreamingProviderOptions = {},
): StreamingProvider {
  const config = createConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createCapabilities(),
    async getAvailability(query, context) {
      return getFlixHqAvailability(config, query, context);
    },
  };
}

function createConfig(options: FlixHqStreamingProviderOptions): FlixHqConfig {
  const maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const playerLimit = options.playerLimit ?? DEFAULT_PLAYER_LIMIT;
  const playerValidationConcurrency =
    options.playerValidationConcurrency ?? DEFAULT_PLAYER_VALIDATION_CONCURRENCY;
  const playerValidationTimeoutMs =
    options.playerValidationTimeoutMs ?? DEFAULT_PLAYER_VALIDATION_TIMEOUT_MS;
  const playerValidationMaxBytes =
    options.playerValidationMaxBytes ?? DEFAULT_PLAYER_VALIDATION_MAX_BYTES;
  const subtitleInfoMaxBytes = options.subtitleInfoMaxBytes ?? DEFAULT_SUBTITLE_INFO_MAX_BYTES;

  if (!Number.isInteger(maxHtmlBytes) || maxHtmlBytes <= 0) {
    throw new TypeError("FlixHQ streaming maxHtmlBytes must be a positive integer.");
  }

  if (!Number.isInteger(playerLimit) || playerLimit <= 0) {
    throw new TypeError("FlixHQ streaming playerLimit must be a positive integer.");
  }

  if (!Number.isInteger(playerValidationConcurrency) || playerValidationConcurrency <= 0) {
    throw new TypeError("FlixHQ streaming playerValidationConcurrency must be a positive integer.");
  }

  if (!Number.isInteger(playerValidationTimeoutMs) || playerValidationTimeoutMs <= 0) {
    throw new TypeError("FlixHQ streaming playerValidationTimeoutMs must be a positive integer.");
  }

  if (!Number.isInteger(playerValidationMaxBytes) || playerValidationMaxBytes <= 0) {
    throw new TypeError("FlixHQ streaming playerValidationMaxBytes must be a positive integer.");
  }

  if (!Number.isInteger(subtitleInfoMaxBytes) || subtitleInfoMaxBytes <= 0) {
    throw new TypeError("FlixHQ streaming subtitleInfoMaxBytes must be a positive integer.");
  }

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    name: normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME),
    fetch: options.fetch,
    maxHtmlBytes,
    playerLimit,
    playerValidationConcurrency,
    playerValidationTimeoutMs,
    playerValidationMaxBytes,
    subtitleInfoMaxBytes,
    userAgent:
      options.userAgent?.trim() || "MediaEngine/0.0 (+https://github.com/Yaneart/media-engine)",
  };
}

function createCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series"],
    lookup: {
      byTitle: true,
      byExternalIds: [],
      byEpisode: true,
    },
    features: [
      "embed",
      "hls",
      "mp4",
      "translations",
      "subtitles",
      "qualities",
      "episode_mapping",
      "headers",
    ],
  };
}

async function getFlixHqAvailability(
  config: FlixHqConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | null> {
  if (query.providers && !query.providers.includes(config.name)) {
    return null;
  }

  if (query.type === "anime" || !query.title?.trim()) {
    return emptyAvailability(query);
  }

  if (
    query.type === "series" &&
    (query.seasonNumber === undefined || query.episodeNumber === undefined)
  ) {
    return emptyAvailability(query);
  }

  const searchUrl = new URL("/search", config.baseUrl);
  searchUrl.searchParams.set("keyword", query.title.trim());
  const searchHtml = await fetchText(config, searchUrl, context);
  const candidate = selectBestCandidate(parseSearchCandidates(searchHtml), query);

  if (!candidate) {
    return emptyAvailability(query);
  }

  const mediaHtml = await fetchText(config, new URL(candidate.mediaUrl), context);
  const episode =
    candidate.type === "movie"
      ? { url: candidate.mediaUrl, title: candidate.title }
      : selectEpisode(parseEpisodes(mediaHtml), query.seasonNumber ?? 1, query.episodeNumber ?? 1);

  if (!episode) {
    return emptyAvailability(query);
  }

  const playerHtml =
    episode.url === candidate.mediaUrl
      ? mediaHtml
      : await fetchText(config, new URL(episode.url), context);
  const token = findPlayerToken(playerHtml, candidate.type);

  if (!token) {
    return emptyAvailability(query);
  }

  const players = await fetchPlayers(config, token, candidate.type, context);
  const mappedOptions = players
    .slice(0, config.playerLimit)
    .map((player, index) => mapPlayer(config, player, episode, index))
    .filter((option): option is StreamOption => option !== null);
  const availableOptions = await filterUnavailablePlayers(config, mappedOptions, context);
  const options = await mapWithConcurrency(
    availableOptions,
    config.playerValidationConcurrency,
    async (option) => enrichPlayerOption(config, option, context),
  );

  return {
    query,
    item: {
      type: query.type,
      title: candidate.title,
      year: candidate.year ?? query.year,
      ids: query.ids,
    },
    options,
    episodes: [{ ...episode, options }],
    sourceProviders: [{ provider: config.name, url: candidate.mediaUrl, ids: query.ids }],
    checkedAt: new Date().toISOString(),
  };
}

async function filterUnavailablePlayers(
  config: FlixHqConfig,
  options: StreamOption[],
  context: ProviderContext,
): Promise<StreamOption[]> {
  const results = await mapWithConcurrency(
    options,
    config.playerValidationConcurrency,
    async (option) => ({
      option,
      unavailable: await isPlayerUnavailable(config, option, context),
    }),
  );

  return results.filter((result) => !result.unavailable).map((result) => result.option);
}

async function isPlayerUnavailable(
  config: FlixHqConfig,
  option: StreamOption,
  context: ProviderContext,
): Promise<boolean> {
  const fetchImpl = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.playerValidationTimeoutMs);
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;

  try {
    if (context.signal?.aborted) {
      throw context.signal.reason;
    }

    const isDirect = option.player.kind === "hls" || option.player.kind === "mp4";
    const response = await fetchImpl(option.access.url, {
      headers: {
        Accept: isDirect
          ? "application/vnd.apple.mpegurl,video/mp4,*/*;q=0.8"
          : "text/html,application/xhtml+xml",
        "User-Agent": config.userAgent,
        Referer: `${config.baseUrl}/`,
        ...(isDirect ? { Range: "bytes=0-0" } : {}),
      },
      signal,
    });

    if (response.status === 404 || response.status === 410 || response.status >= 500) {
      return true;
    }

    if (!response.ok && response.status !== 206) return false;

    if (isDirect) {
      await response.body?.cancel();
      return false;
    }

    const html = await readBoundedResponseText(response, config.playerValidationMaxBytes);
    return hasUnavailableMarker(html);
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    // A validation timeout or transient network failure must not hide a discovered player.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichPlayerOption(
  config: FlixHqConfig,
  option: StreamOption,
  context: ProviderContext,
): Promise<StreamOption> {
  const subtitleInfoUrl = findSubtitleInfoUrl(option.access.url);
  if (!subtitleInfoUrl) return option;

  try {
    const response = await (config.fetch ?? fetch)(subtitleInfoUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
        Referer: option.access.url,
      },
      signal: context.signal,
    });
    if (!response.ok) return option;

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > config.subtitleInfoMaxBytes) {
      await response.body?.cancel();
      return option;
    }

    const text = await readBoundedResponseText(response, config.subtitleInfoMaxBytes);
    const subtitles = parseSubtitleInfo(text);
    return subtitles.length > 0 ? { ...option, subtitles } : option;
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    // Subtitle metadata is optional and must never hide an otherwise working player.
    return option;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => worker()),
  );
  return results;
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function hasUnavailableMarker(html: string): boolean {
  const normalized = normalizeTitle(html);
  return (
    normalized.includes("video not found") ||
    normalized.includes("file was deleted") ||
    normalized.includes("file has been deleted") ||
    normalized.includes("video is unavailable") ||
    normalized.includes("404 not found")
  );
}

async function fetchPlayers(
  config: FlixHqConfig,
  token: string,
  type: SearchCandidate["type"],
  context: ProviderContext,
): Promise<PlayerResponse[]> {
  const body = new URLSearchParams();
  body.set(type === "movie" ? "players" : "players_show", token);
  const responseText = await fetchText(config, new URL("/ajax/ajax.php", config.baseUrl), context, {
    method: "POST",
    headers: {
      ...createHeaders(config),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });

  try {
    const parsed: unknown = JSON.parse(responseText);
    const values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return values.filter(isPlayerResponse);
  } catch (error) {
    throw mapProviderHttpError(config.name, error);
  }
}

function mapPlayer(
  config: FlixHqConfig,
  player: PlayerResponse,
  episode: EpisodeCandidate,
  index: number,
): StreamOption | null {
  const url = normalizeHttpUrl(player.link);
  if (!url) return null;

  const label = decodeHtml(player.name ?? "").trim() || `Server ${index + 1}`;
  const kind = inferPlayerKind(url);
  const quality = inferQuality(label, url);
  const expiresAt = inferExpiresAt(url);

  return {
    id: `${config.name}:${episode.seasonNumber ?? 0}:${episode.episodeNumber ?? 0}:${index + 1}`,
    provider: config.name,
    player: { kind, label },
    translation: {
      title: "Original / subtitles",
      type: "unknown",
    },
    episode: {
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    },
    access: {
      url,
      referer: `${config.baseUrl}/`,
      headers: { Referer: `${config.baseUrl}/` },
    },
    availability: "available",
    ...(quality ? { quality } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    sourceUrl: episode.url,
  };
}

export function parseSubtitleInfo(value: string): SubtitleTrack[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const tracks: SubtitleTrack[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    if (tracks.length >= SUBTITLE_TRACK_LIMIT) break;
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as SubtitleInfoEntry;
    const url = typeof entry.file === "string" ? normalizeHttpUrl(entry.file) : undefined;
    if (!url || seen.has(url)) continue;

    const label = typeof entry.label === "string" ? decodeHtml(entry.label).trim() : "";
    const language = inferSubtitleLanguage(label);
    seen.add(url);
    tracks.push({
      ...(language ? { language } : {}),
      ...(label ? { label: entry.default === true ? `${label} (default)` : label } : {}),
      format: inferSubtitleFormat(url),
      url,
    });
  }

  return tracks;
}

export function parseSearchCandidates(html: string): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();

  for (const anchor of parseAnchors(html)) {
    const href = normalizeHttpUrl(getAttribute(anchor.attributes, "href"));
    const type = href?.includes("/watch-movie/")
      ? "movie"
      : href?.includes("/watch-series/")
        ? "series"
        : undefined;

    if (!href || !type || seen.has(href)) continue;

    const rawTitle = getAttribute(anchor.attributes, "title") ?? stripTags(anchor.content);
    const title = cleanSearchTitle(decodeHtml(rawTitle));
    if (!title) continue;

    const year = parseYear(href) ?? parseYear(html.slice(anchor.index, anchor.index + 600));
    seen.add(href);
    candidates.push({ mediaUrl: href, title, year, type });
  }

  return candidates;
}

export function parseEpisodes(html: string): EpisodeCandidate[] {
  return parseAnchors(html).flatMap((anchor) => {
    const href = normalizeHttpUrl(getAttribute(anchor.attributes, "href"));
    const match = href?.match(/\/s(\d+)-e(\d+)\/?$/i);
    if (!href || !match) return [];

    const title = decodeHtml(
      getAttribute(anchor.attributes, "title") ?? stripTags(anchor.content),
    ).trim();
    return [
      {
        url: href,
        title: title || undefined,
        seasonNumber: Number(match[1]),
        episodeNumber: Number(match[2]),
      },
    ];
  });
}

function selectBestCandidate(
  candidates: SearchCandidate[],
  query: MediaAvailability["query"],
): SearchCandidate | undefined {
  const type = query.type === "movie" ? "movie" : "series";
  const title = normalizeTitle(query.title ?? "");

  return candidates
    .filter((candidate) => candidate.type === type)
    .map((candidate, index) => ({
      candidate,
      score:
        titleScore(normalizeTitle(candidate.title), title) +
        (query.year && candidate.year === query.year ? 30 : 0) -
        (query.year && candidate.year && candidate.year !== query.year ? 20 : 0) -
        index / 100,
    }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

function selectEpisode(
  episodes: EpisodeCandidate[],
  seasonNumber: number,
  episodeNumber: number,
): EpisodeCandidate | undefined {
  return episodes.find(
    (episode) => episode.seasonNumber === seasonNumber && episode.episodeNumber === episodeNumber,
  );
}

function findPlayerToken(html: string, type: SearchCandidate["type"]): string | undefined {
  const requiredClass = type === "movie" ? "page-detail" : "w_b-player";
  for (const tag of html.matchAll(/<[^>]+>/g)) {
    const attributes = tag[0];
    const classes = getAttribute(attributes, "class")?.split(/\s+/) ?? [];
    const id = getAttribute(attributes, "id");
    if (classes.includes(requiredClass) || (type === "series" && id === "series-player")) {
      const token = getAttribute(attributes, "data-token")?.trim();
      if (token) return token;
    }
  }
  return undefined;
}

interface ParsedAnchor {
  attributes: string;
  content: string;
  index: number;
}

function parseAnchors(html: string): ParsedAnchor[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attributes: match[1] ?? "",
    content: match[2] ?? "",
    index: match.index,
  }));
}

function getAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return attributes.match(expression)?.[2];
}

async function fetchText(
  config: FlixHqConfig,
  url: URL,
  context: ProviderContext,
  init: RequestInit = {},
): Promise<string> {
  const fetchImpl = config.fetch ?? fetch;

  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: init.headers ?? createHeaders(config),
      signal: context.signal,
    });
    if (!response.ok) {
      throw new Error(`Provider "${config.name}" returned HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > config.maxHtmlBytes) {
      throw new Error(`Provider "${config.name}" returned an oversized response.`);
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > config.maxHtmlBytes) {
      throw new Error(`Provider "${config.name}" returned an oversized response.`);
    }
    return new TextDecoder().decode(body);
  } catch (error) {
    throw mapProviderHttpError(config.name, error);
  }
}

function createHeaders(config: FlixHqConfig): Record<string, string> {
  return {
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": config.userAgent,
    Referer: `${config.baseUrl}/`,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function isPlayerResponse(value: unknown): value is PlayerResponse {
  return typeof value === "object" && value !== null;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("FlixHQ streaming baseUrl must use HTTP or HTTPS.");
  }
  return url.href.replace(/\/$/, "");
}

function normalizeProviderName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("FlixHQ streaming provider name is required.");
  return name;
}

function normalizeHttpUrl(value: string | null | undefined): string | undefined {
  return normalizePublicHttpUrl(value);
}

function findSubtitleInfoUrl(playerUrl: string): string | undefined {
  try {
    const value = new URL(playerUrl).searchParams.get("sub.info");
    return normalizeHttpUrl(value);
  } catch {
    return undefined;
  }
}

function inferPlayerKind(url: string): StreamOption["player"]["kind"] {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".m3u8")) return "hls";
    if (pathname.endsWith(".mp4")) return "mp4";
  } catch {
    // The URL was already normalized, so this is only a defensive fallback.
  }
  return "embed";
}

function inferQuality(label: string, url: string): StreamOption["quality"] | undefined {
  const match = `${label} ${url}`.match(
    /(?:^|[^\d])(2160|1440|1080|720|576|480|360|240)p?(?:[^\d]|$)/i,
  );
  if (!match) return undefined;
  const height = Number(match[1]);
  return { label: `${height}p`, height };
}

function inferExpiresAt(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  for (const name of ["expires", "expire", "exp"]) {
    const rawValue = url.searchParams.get(name)?.trim();
    if (!rawValue) continue;

    const numeric = Number(rawValue);
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
      : new Date(rawValue);
    if (!Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 2000) return date.toISOString();
  }
  return undefined;
}

function inferSubtitleFormat(url: string): SubtitleTrack["format"] {
  try {
    const extension = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (extension === "vtt" || extension === "srt" || extension === "ass") return extension;
  } catch {
    // The URL was already normalized, so this is only a defensive fallback.
  }
  return "unknown";
}

function inferSubtitleLanguage(label: string): string | undefined {
  const normalized = normalizeTitle(label);
  const mappings: Array<[RegExp, string]> = [
    [/\b(bulgarian|bul)\b/, "bg"],
    [/\b(czech|ces|cze)\b/, "cs"],
    [/\b(danish|dan)\b/, "da"],
    [/\b(dutch|nld|dut)\b/, "nl"],
    [/\b(english|eng)\b/, "en"],
    [/\b(estonian|est)\b/, "et"],
    [/\b(finnish|fin)\b/, "fi"],
    [/\b(spanish|espanol|spa)\b/, "es"],
    [/\b(french|francais|fre|fra)\b/, "fr"],
    [/\b(german|deutsch|ger|deu)\b/, "de"],
    [/\b(greek|ell|gre)\b/, "el"],
    [/\b(hebrew|heb)\b/, "he"],
    [/\b(croatian|hrv)\b/, "hr"],
    [/\b(hungarian|hun)\b/, "hu"],
    [/\b(icelandic|isl|ice)\b/, "is"],
    [/\b(indonesian|ind)\b/, "id"],
    [/\b(italian|italiano|ita)\b/, "it"],
    [/\b(latvian|lav)\b/, "lv"],
    [/\b(lithuanian|lit)\b/, "lt"],
    [/\b(macedonian|mkd|mac)\b/, "mk"],
    [/\b(malay|msa|may)\b/, "ms"],
    [/\b(norwegian|nob)\b/, "nb"],
    [/\b(polish|pol)\b/, "pl"],
    [/\b(pob)\b/, "pt-BR"],
    [/\b(portuguese|portugues|por)\b/, "pt"],
    [/\b(romanian|ron|rum)\b/, "ro"],
    [/\b(serbian|srp)\b/, "sr"],
    [/\b(sinhala|sinhalese|sin)\b/, "si"],
    [/\b(slovak|slk|slo)\b/, "sk"],
    [/\b(slovenian|slv)\b/, "sl"],
    [/\b(swedish|swe)\b/, "sv"],
    [/\b(thai|tha)\b/, "th"],
    [/\b(japanese|jpn|jap)\b/, "ja"],
    [/\b(korean|kor)\b/, "ko"],
    [/\b(chinese|chi|zho)\b/, "zh"],
    [/\b(arabic|ara)\b/, "ar"],
    [/\b(hindi|hin)\b/, "hi"],
    [/\b(turkish|tur)\b/, "tr"],
    [/\b(russian|rus)\b|русск/, "ru"],
    [/\b(ukrainian|ukr)\b|україн|украин/, "uk"],
  ];
  return mappings.find(([pattern]) => pattern.test(normalized))?.[1];
}

function cleanSearchTitle(value: string): string {
  return value.replace(/\s*(?:watch online|flixhq).*$/i, "").trim();
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleScore(candidate: string, query: string): number {
  if (candidate === query) return 100;
  if (candidate.includes(query) || query.includes(candidate)) return 70;
  const tokens = new Set(query.split(" ").filter(Boolean));
  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const shared = [...tokens].filter((token) => candidateTokens.has(token)).length;
  return tokens.size === 0 ? 0 : (shared / tokens.size) * 60;
}

function parseYear(value: string): number | undefined {
  const match = stripTags(value).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function emptyAvailability(query: MediaAvailability["query"]): MediaAvailability {
  return { query, options: [], sourceProviders: [], checkedAt: new Date().toISOString() };
}
