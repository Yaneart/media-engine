import type {
  MediaAvailability,
  ProviderContext,
  StreamEpisodeRef,
  StreamOption,
  StreamingProvider,
  StreamingProviderCapabilities,
} from "@media-engine/core";
import { mapProviderHttpError, type ProviderFetch } from "../shared/index.js";

const DEFAULT_BASE_URL = "https://flixhq.one";
const DEFAULT_PROVIDER_NAME = "flixhq-streaming";
const DEFAULT_MAX_HTML_BYTES = 1024 * 1024;
const DEFAULT_PLAYER_LIMIT = 8;

export interface FlixHqStreamingProviderOptions {
  baseUrl?: string;
  name?: string;
  version?: string;
  fetch?: ProviderFetch;
  maxHtmlBytes?: number;
  playerLimit?: number;
  userAgent?: string;
}

interface FlixHqConfig {
  baseUrl: string;
  name: string;
  fetch?: ProviderFetch;
  maxHtmlBytes: number;
  playerLimit: number;
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

  if (!Number.isInteger(maxHtmlBytes) || maxHtmlBytes <= 0) {
    throw new TypeError("FlixHQ streaming maxHtmlBytes must be a positive integer.");
  }

  if (!Number.isInteger(playerLimit) || playerLimit <= 0) {
    throw new TypeError("FlixHQ streaming playerLimit must be a positive integer.");
  }

  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    name: normalizeProviderName(options.name ?? DEFAULT_PROVIDER_NAME),
    fetch: options.fetch,
    maxHtmlBytes,
    playerLimit,
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
    features: ["embed", "translations", "episode_mapping", "headers"],
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
  const options = players
    .slice(0, config.playerLimit)
    .map((player, index) => mapPlayer(config, player, episode, index))
    .filter((option): option is StreamOption => option !== null);

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

  return {
    id: `${config.name}:${episode.seasonNumber ?? 0}:${episode.episodeNumber ?? 0}:${index + 1}`,
    provider: config.name,
    player: { kind: "embed", label },
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
    sourceUrl: episode.url,
  };
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
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
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
