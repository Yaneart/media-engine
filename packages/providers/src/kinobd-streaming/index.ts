import type {
  ExternalIds,
  MediaAvailability,
  MediaType,
  ProviderContext,
  StreamOption,
  StreamingProvider,
  StreamingProviderCapabilities,
  TranslationInfo,
} from "@media-engine/core";
import { fetchJson, type ProviderFetch } from "../shared/index.js";

const PROVIDER_NAME = "kinobd-streaming";
const DEFAULT_BASE_URL = "https://kinobd.net";
const DEFAULT_SHIKIMORI_BASE_URL = "https://shikimori.io";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_PLAYER_VALIDATION_LIMIT = 8;
const DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS = 2_500;
const PLAYER_VALIDATION_TIMEOUT_MS = 2_500;
const PLAYER_VALIDATION_MAX_DEPTH = 1;
const DEFAULT_PLAYER_PROVIDERS = [
  "collaps",
  "vibix",
  "alloha",
  "kodik",
  "kinotochka",
  "flixcdn",
  "ashdi",
  "turbo",
  "videocdn",
  "bazon",
  "ustore",
  "pleer",
  "videospider",
  "iframe",
  "moonwalk",
  "hdvb",
  "cdnmovies",
  "lookbase",
  "kholobok",
  "videoapi",
  "voidboost",
  "videoseed",
  "vk",
].join(",");
const BLOCKED_PLAYER_PROVIDERS = new Set([
  "ext",
  "ia",
  "netflix",
  "nf",
  "torrent",
  "trailer",
  "trailer_local",
  "youtube",
]);
const KNOWN_RUSSIAN_VOICEOVER_TEAMS = [
  "2x2",
  "alexfilm",
  "anidub",
  "anilibria",
  "coldfilm",
  "cube",
  "hdrezka studio",
  "jaskier",
  "kubik",
  "le-production",
  "lostfilm",
  "newstudio",
  "shachiburi",
];

// Options used to create the no-token KinoBD/ReYohoho-style streaming provider.
// Опции для создания no-token KinoBD/ReYohoho-style streaming-провайдера.
export interface KinoBdStreamingProviderOptions {
  name?: string;
  version?: string;
  baseUrl?: string;
  animeCacheBaseUrl?: string;
  shikimoriBaseUrl?: string;
  fetch?: ProviderFetch;
  searchLimit?: number;
  shikimoriLookupTimeoutMs?: number;
  playerValidationLimit?: number;
  playerValidationTimeoutMs?: number;
  playerProviders?: string;
  fast?: number;
  userAgent?: string;
  onPlayerAudit?: (audit: KinoBdPlayerAudit) => void;
}

// Stable reasons why a discovered KinoBD player was not returned.
// Стабильные причины, по которым найденный KinoBD player не был возвращен.
export type KinoBdPlayerFilterReason =
  "provider_not_allowed" | "missing_iframe" | "known_broken_url" | "player_validation_failed";

// One player removed during mapping or live validation.
// Один player, удаленный во время mapping или live validation.
export interface KinoBdFilteredPlayerAuditEntry {
  player: string;
  reason: KinoBdPlayerFilterReason;
  url?: string;
}

// Diagnostic snapshot emitted after one KinoBD player lookup.
// Диагностический snapshot после одного KinoBD player lookup.
export interface KinoBdPlayerAudit {
  query: MediaAvailability["query"];
  discovered: string[];
  shown: string[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

// Creates a no-token streaming provider that asks KinoBD-style endpoints for iframe players.
// Создает no-token streaming-провайдер, который запрашивает iframe-плееры через KinoBD-style endpoints.
export function kinobdStreamingProvider(
  options: KinoBdStreamingProviderOptions = {},
): StreamingProvider {
  const config = createConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createCapabilities(),
    async getAvailability(query, context) {
      return getKinoBdAvailability(config, query, context);
    },
  };
}

// Internal normalized provider configuration.
// Внутренняя нормализованная конфигурация provider.
interface KinoBdStreamingConfig {
  name: string;
  baseUrl: string;
  animeCacheBaseUrl?: string;
  shikimoriBaseUrl: string;
  fetch?: ProviderFetch;
  searchLimit: number;
  shikimoriLookupTimeoutMs: number;
  playerValidationLimit: number;
  playerValidationTimeoutMs: number;
  playerProviders: string;
  allowedPlayerProviders: ReadonlySet<string>;
  fast: number;
  userAgent?: string;
  onPlayerAudit?: (audit: KinoBdPlayerAudit) => void;
}

interface PlayerOptionMapping {
  options: StreamOption[];
  discovered: string[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

interface PlayerOptionFilterResult {
  options: StreamOption[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

// Search response returned by KinoBD-style player lookup.
// Search response, который возвращает KinoBD-style player lookup.
interface PlayerSearchResponse {
  data?: PlayerCandidate[];
}

// Candidate item used to request concrete provider players through /playerdata.
// Candidate item для запроса конкретных provider players через /playerdata.
interface PlayerCandidate {
  id?: string | number | null;
  inid?: string | number | null;
  kp_id?: string | number | null;
  kinopoisk_id?: string | number | null;
  imdb_id?: string | null;
  title?: string | null;
  name_russian?: string | null;
  name_original?: string | null;
  year?: string | number | null;
  year_start?: string | number | null;
  year_end?: string | number | null;
  rating_kp?: string | number | null;
  rating_kp_count?: string | number | null;
  rating_imdb?: string | number | null;
  rating_imdb_count?: string | number | null;
  type?: string | null;
  popular_rate?: string | number | null;
  popularity?: {
    popular_rate?: string | number | null;
  } | null;
  iframe?: string | null;
}

// Map of provider names to iframe player payloads.
// Map имен provider к payload iframe-плееров.
type PlayerDataResponse = Record<string, PlayerPayload>;

// Minimal player payload shape used by ReYohoho/KinoBD-style backends.
// Минимальная форма player payload, которую используют ReYohoho/KinoBD-style backends.
interface PlayerPayload {
  name?: string | null;
  translate?: string | null;
  iframe?: string | null;
  quality?: string | null;
  warning?: boolean | null;
  source?: string | null;
}

// Minimal Shikimori payload used only to resolve a Shikimori ID into a title fallback.
// Минимальный payload Shikimori только для резолва Shikimori ID в title fallback.
interface ShikimoriAnimeLookup {
  name?: string | null;
  russian?: string | null;
  english?: string[] | null;
  aired_on?: string | null;
}

// Builds provider config with ReYohoho-compatible defaults.
// Собирает provider config с ReYohoho-compatible defaults.
function createConfig(options: KinoBdStreamingProviderOptions): KinoBdStreamingConfig {
  const searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  const shikimoriLookupTimeoutMs =
    options.shikimoriLookupTimeoutMs ?? DEFAULT_SHIKIMORI_LOOKUP_TIMEOUT_MS;
  const playerValidationLimit = options.playerValidationLimit ?? DEFAULT_PLAYER_VALIDATION_LIMIT;
  const playerValidationTimeoutMs =
    options.playerValidationTimeoutMs ?? PLAYER_VALIDATION_TIMEOUT_MS;
  const fast = options.fast ?? 1;
  const allowedPlayerProviders = parsePlayerProviderKeys(
    options.playerProviders ?? DEFAULT_PLAYER_PROVIDERS,
  );

  if (!Number.isInteger(searchLimit) || searchLimit <= 0) {
    throw new TypeError("KinoBD streaming searchLimit must be a positive integer.");
  }

  if (!Number.isInteger(shikimoriLookupTimeoutMs) || shikimoriLookupTimeoutMs <= 0) {
    throw new TypeError("KinoBD streaming shikimoriLookupTimeoutMs must be a positive integer.");
  }

  if (!Number.isInteger(playerValidationLimit) || playerValidationLimit < 0) {
    throw new TypeError("KinoBD streaming playerValidationLimit must be a non-negative integer.");
  }

  if (!Number.isInteger(playerValidationTimeoutMs) || playerValidationTimeoutMs <= 0) {
    throw new TypeError("KinoBD streaming playerValidationTimeoutMs must be a positive integer.");
  }

  if (!Number.isInteger(fast) || fast < 0) {
    throw new TypeError("KinoBD streaming fast must be a non-negative integer.");
  }

  return {
    name: normalizeProviderName(options.name ?? PROVIDER_NAME),
    baseUrl: trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL),
    animeCacheBaseUrl:
      options.animeCacheBaseUrl === undefined
        ? undefined
        : trimTrailingSlash(options.animeCacheBaseUrl),
    shikimoriBaseUrl: trimTrailingSlash(options.shikimoriBaseUrl ?? DEFAULT_SHIKIMORI_BASE_URL),
    fetch: options.fetch,
    searchLimit,
    shikimoriLookupTimeoutMs,
    playerValidationLimit,
    playerValidationTimeoutMs,
    playerProviders: [...allowedPlayerProviders].join(","),
    allowedPlayerProviders,
    fast,
    userAgent: options.userAgent,
    onPlayerAudit: options.onPlayerAudit,
  };
}

// Builds safe capabilities for the public engine/API.
// Собирает безопасные capabilities для публичного engine/API.
function createCapabilities(): StreamingProviderCapabilities {
  return {
    mediaTypes: ["movie", "series", "anime"],
    lookup: {
      byTitle: true,
      byExternalIds: ["kinopoisk", "shikimori"],
      byEpisode: true,
    },
    features: ["embed", "translations", "qualities", "episode_mapping"],
  };
}

// Resolves availability through movie/series or anime player endpoints.
// Получает availability через movie/series или anime player endpoints.
async function getKinoBdAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | null> {
  if (query.providers && !query.providers.includes(config.name)) {
    return null;
  }

  if (query.type === "anime") {
    return getAnimeAvailability(config, query, context);
  }

  return getMovieOrSeriesAvailability(config, query, context);
}

// Resolves anime availability through optional cache_shiki first, then KinoBD title fallback.
// Получает anime availability через опциональный cache_shiki, затем через KinoBD title fallback.
async function getAnimeAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability> {
  if (config.animeCacheBaseUrl && query.ids?.shikimori) {
    const cached = await tryGetShikimoriCacheAvailability(config, query, context);

    if (cached && cached.options.length > 0) {
      return cached;
    }
  }

  const fallbackQuery = await createAnimeTitleFallbackQuery(config, query, context);

  if (!fallbackQuery.title && !fallbackQuery.ids?.kinopoisk) {
    return createEmptyAvailability(query);
  }

  return getMovieOrSeriesAvailability(config, fallbackQuery, context);
}

// Resolves movie or series players through /api/player/search and /playerdata.
// Получает movie или series players через /api/player/search и /playerdata.
async function getMovieOrSeriesAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability> {
  const candidates = await searchPlayerCandidates(config, query, context);
  const selected = selectBestPlayerCandidate(candidates, query);

  if (!selected) {
    return createEmptyAvailability(query);
  }

  const options = await loadPlayerOptions(config, selected, candidates, query, context);

  return {
    query,
    item: {
      type: query.type,
      title: selected.title ?? selected.name_russian ?? query.title,
      originalTitle: selected.name_original ?? undefined,
      year: getCandidateStartYear(selected) ?? query.year,
      ids: collectCandidateIds(selected) ?? query.ids,
    },
    options,
    sourceProviders: [
      {
        provider: config.name,
        ids: collectCandidateIds(selected) ?? query.ids,
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

// Loads playerdata first and falls back to candidate iframes when the player endpoint is unavailable.
// Сначала грузит playerdata и откатывается к iframe-кандидатам, если player endpoint недоступен.
async function loadPlayerOptions(
  config: KinoBdStreamingConfig,
  selected: PlayerCandidate,
  candidates: PlayerCandidate[],
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<StreamOption[]> {
  try {
    const playerData = await loadPlayerData(config, selected, context);
    const mapping = mapPlayerMapToOptions(
      config.name,
      playerData,
      selected,
      query,
      config.allowedPlayerProviders,
    );

    if (mapping.options.length > 0) {
      const filtered = await filterBrokenPlayerOptions(config, mapping.options, context);

      emitPlayerAudit(config, query, mapping.discovered, filtered.options, [
        ...mapping.filtered,
        ...filtered.filtered,
      ]);

      return filtered.options;
    }

    const fallbackOptions = mapCandidatesToFallbackOptions(config.name, [selected], query);

    emitPlayerAudit(config, query, mapping.discovered, fallbackOptions, mapping.filtered);

    return fallbackOptions;
  } catch {
    // KinoBD/ReYohoho-style /playerdata can be rate-limited or temporarily unavailable.
    // KinoBD/ReYohoho-style /playerdata может быть rate-limited или временно недоступен.
  }

  const fallbackOptions = mapCandidatesToFallbackOptions(config.name, [selected], query);

  emitPlayerAudit(
    config,
    query,
    fallbackOptions.map((option) => option.player.label),
    fallbackOptions,
    [],
  );

  return fallbackOptions;
}

// Resolves anime players through /cache_shiki-compatible backend endpoint.
// Получает anime players через /cache_shiki-compatible backend endpoint.
async function tryGetShikimoriCacheAvailability(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability | undefined> {
  const url = new URL("/cache_shiki", `${config.animeCacheBaseUrl}/`);
  const body = new URLSearchParams({
    shikimori: query.ids!.shikimori!,
    type: "anime",
  });

  try {
    const playerData = await fetchJson<PlayerDataResponse>({
      provider: config.name,
      url,
      context,
      fetch: config.fetch,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    });
    const mapping = mapPlayerMapToOptions(
      config.name,
      playerData,
      undefined,
      query,
      config.allowedPlayerProviders,
    );
    const options = mapping.options;

    emitPlayerAudit(config, query, mapping.discovered, options, mapping.filtered);

    return {
      query,
      item: {
        type: "anime",
        title: query.title,
        year: query.year,
        ids: query.ids,
      },
      episodes: hasEpisodeQuery(query)
        ? [
            {
              seasonNumber: query.seasonNumber,
              episodeNumber: query.episodeNumber,
              absoluteEpisodeNumber: query.absoluteEpisodeNumber,
              options,
            },
          ]
        : undefined,
      options,
      sourceProviders: [
        {
          provider: config.name,
          ids: query.ids,
        },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

// Builds an anime fallback query that KinoBD player search can understand.
// Собирает anime fallback query, который понимает KinoBD player search.
async function createAnimeTitleFallbackQuery(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability["query"]> {
  if (query.title) {
    return query;
  }

  if (!query.ids?.shikimori) {
    return query;
  }

  const lookup = await tryLookupShikimoriAnime(config, query.ids.shikimori, context);
  const title =
    lookup?.russian?.trim() ||
    lookup?.name?.trim() ||
    lookup?.english?.find((value) => value.trim())?.trim();

  return {
    ...query,
    title,
    year: query.year ?? parseYear(lookup?.aired_on),
  };
}

// Resolves Shikimori ID into title metadata without requiring user secrets.
// Резолвит Shikimori ID в title metadata без пользовательских секретов.
async function tryLookupShikimoriAnime(
  config: KinoBdStreamingConfig,
  shikimoriId: string,
  context: ProviderContext,
): Promise<ShikimoriAnimeLookup | undefined> {
  const url = new URL(
    `/api/animes/${encodeURIComponent(shikimoriId)}`,
    `${config.shikimoriBaseUrl}/`,
  );
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (config.userAgent) {
    headers["user-agent"] = config.userAgent;
  }

  try {
    return await fetchJson<ShikimoriAnimeLookup>({
      provider: config.name,
      url,
      context: {
        ...context,
        timeoutMs: getBoundedTimeoutMs(context.timeoutMs, config.shikimoriLookupTimeoutMs),
      },
      fetch: config.fetch,
      maxRetries: 0,
      init: {
        headers,
      },
    });
  } catch {
    return undefined;
  }
}

// Keeps helper lookups inside the remaining provider budget when one exists.
// Удерживает вспомогательные lookup-запросы внутри общего бюджета провайдера, если он задан.
function getBoundedTimeoutMs(
  contextTimeoutMs: number | undefined,
  fallbackTimeoutMs: number,
): number {
  return contextTimeoutMs === undefined
    ? fallbackTimeoutMs
    : Math.min(contextTimeoutMs, fallbackTimeoutMs);
}

// Searches KinoBD player candidates by Kinopoisk ID or title.
// Ищет KinoBD player candidates по Kinopoisk ID или title.
async function searchPlayerCandidates(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<PlayerCandidate[]> {
  const search = createCandidateSearch(query);

  if (!search) {
    return [];
  }

  const url = new URL("/api/player/search", `${config.baseUrl}/`);

  url.searchParams.set("q", search.value);
  url.searchParams.set("type", search.type);
  url.searchParams.set("page", "1");

  const response = await fetchJson<PlayerSearchResponse>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    init: {
      headers: {
        accept: "application/json",
      },
    },
  });

  return (response.data ?? []).slice(0, config.searchLimit);
}

// Chooses the most likely KinoBD record instead of trusting upstream result order.
// Выбирает наиболее вероятную KinoBD-запись вместо доверия порядку upstream results.
function selectBestPlayerCandidate(
  candidates: PlayerCandidate[],
  query: MediaAvailability["query"],
): PlayerCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  if (query.ids?.kinopoisk || query.ids?.imdb) {
    const exact = candidates.find((candidate) => hasExactCandidateId(candidate, query.ids));

    if (exact) {
      return exact;
    }
  }

  const normalizedTitle = normalizeSearchText(query.title ?? "");

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scorePlayerCandidate(candidate, query, normalizedTitle),
    }))
    .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

function scorePlayerCandidate(
  candidate: PlayerCandidate,
  query: MediaAvailability["query"],
  normalizedTitle: string,
): number {
  const candidateType = mapCandidateMediaType(candidate.type);
  const queryType = query.type === "movie" || query.type === "series" ? query.type : undefined;

  if (queryType && candidateType && candidateType !== queryType) {
    return Number.NEGATIVE_INFINITY;
  }

  const startYear = getCandidateStartYear(candidate);
  const endYear = parseOptionalInteger(candidate.year_end);

  if (query.year !== undefined) {
    if (startYear === undefined) {
      return Number.NEGATIVE_INFINITY;
    }

    if (queryType === "series") {
      const lastYear = endYear ?? startYear;

      if (query.year < startYear || query.year > lastYear) {
        return Number.NEGATIVE_INFINITY;
      }
    } else if (startYear !== query.year) {
      return Number.NEGATIVE_INFINITY;
    }
  }

  const original = normalizeSearchText(candidate.name_original ?? "");
  const russian = normalizeSearchText(candidate.name_russian ?? candidate.title ?? "");
  const popularity =
    parseOptionalInteger(candidate.popular_rate ?? candidate.popularity?.popular_rate) ?? 0;
  const votes =
    parseOptionalInteger(candidate.rating_kp_count) ??
    parseOptionalInteger(candidate.rating_imdb_count) ??
    0;
  const rating =
    parseOptionalInteger(candidate.rating_kp) ?? parseOptionalInteger(candidate.rating_imdb) ?? 0;
  let score = 10;

  if (queryType && candidateType === queryType) {
    score += 40;
  }

  if (normalizedTitle && (original === normalizedTitle || russian === normalizedTitle)) {
    score += 80;
  } else if (
    normalizedTitle &&
    (original.includes(normalizedTitle) || russian.includes(normalizedTitle))
  ) {
    score += 25;
  }

  if (query.year !== undefined && startYear !== undefined) {
    score += startYear === query.year ? 35 : 15;
  }

  if (candidate.imdb_id) {
    score += 5;
  }

  if (candidate.kinopoisk_id ?? candidate.kp_id) {
    score += 5;
  }

  score += Math.min(8, rating);
  score += Math.min(10, Math.log10(votes + 1) * 2);
  score += Math.min(12, Math.log10(popularity + 1) * 2);

  return score;
}

function hasExactCandidateId(candidate: PlayerCandidate, ids: ExternalIds | undefined): boolean {
  const candidateIds = collectCandidateIds(candidate);

  return Boolean(
    (ids?.kinopoisk && candidateIds?.kinopoisk === ids.kinopoisk) ||
    (ids?.imdb && candidateIds?.imdb === ids.imdb),
  );
}

function mapCandidateMediaType(type: string | null | undefined): MediaType | undefined {
  if (type === "film") {
    return "movie";
  }

  if (type === "serial" || type === "series") {
    return "series";
  }

  return undefined;
}

function getCandidateStartYear(candidate: PlayerCandidate): number | undefined {
  return parseOptionalInteger(candidate.year ?? candidate.year_start);
}

// Creates the best supported player search input from a stream query.
// Создает лучший поддерживаемый input поиска player из stream query.
function createCandidateSearch(
  query: MediaAvailability["query"],
): { type: "kp_id" | "title"; value: string } | undefined {
  if (query.ids?.kinopoisk) {
    return {
      type: "kp_id",
      value: query.ids.kinopoisk,
    };
  }

  if (query.title) {
    return {
      type: "title",
      value: query.title,
    };
  }

  return undefined;
}

// Loads provider iframe data for a selected candidate.
// Загружает provider iframe data для выбранного candidate.
async function loadPlayerData(
  config: KinoBdStreamingConfig,
  candidate: PlayerCandidate,
  context: ProviderContext,
): Promise<PlayerDataResponse> {
  const inid = candidate.inid ?? candidate.id;

  if (inid === undefined || inid === null) {
    return {};
  }

  const url = new URL("/playerdata", `${config.baseUrl}/`);

  url.search = `cache${String(inid)}`;

  const body = new URLSearchParams({
    fast: String(config.fast),
    inid: String(inid),
    player: config.playerProviders,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const iframe = extractIframeUrl(candidate.iframe, config.baseUrl);

  if (iframe) {
    headers["x-re"] = iframe;
  }

  return fetchJson<PlayerDataResponse>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    init: {
      method: "POST",
      headers,
      body,
    },
  });
}

// Maps a provider player map into normalized stream options.
// Мапит provider player map в нормализованные stream options.
function mapPlayerMapToOptions(
  providerName: string,
  playerMap: PlayerDataResponse,
  candidate: PlayerCandidate | undefined,
  query: MediaAvailability["query"],
  allowedPlayerProviders: ReadonlySet<string>,
): PlayerOptionMapping {
  const options: StreamOption[] = [];
  const discovered: string[] = [];
  const filtered: KinoBdFilteredPlayerAuditEntry[] = [];

  for (const [providerKey, payload] of Object.entries(playerMap)) {
    const player = normalizeProviderLabel(providerKey);

    discovered.push(player);

    if (!isAllowedPlayerProvider(providerKey, allowedPlayerProviders)) {
      filtered.push({ player, reason: "provider_not_allowed" });
      continue;
    }

    const option = mapPayloadToOption(providerName, providerKey, payload, candidate, query);

    if (!option) {
      filtered.push({ player, reason: "missing_iframe" });
      continue;
    }

    options.push(option);
  }

  return { options, discovered, filtered };
}

async function filterBrokenPlayerOptions(
  config: KinoBdStreamingConfig,
  options: StreamOption[],
  context: ProviderContext,
): Promise<PlayerOptionFilterResult> {
  const knownBrokenOptions = options.filter((option) => isKnownBrokenPlayerUrl(option.access.url));
  const optionsWithoutKnownBrokenUrls = options.filter(
    (option) => !knownBrokenOptions.includes(option),
  );
  const optionsToValidate = optionsWithoutKnownBrokenUrls.slice(0, config.playerValidationLimit);
  const optionsSkippedByLimit = optionsWithoutKnownBrokenUrls.slice(config.playerValidationLimit);
  const checks = await Promise.all(
    optionsToValidate.map(async (option) => ({
      option,
      broken: await isBrokenPlayerUrl(config, option.access.url, context),
    })),
  );

  return {
    options: [
      ...checks.filter((check) => !check.broken).map((check) => check.option),
      ...optionsSkippedByLimit,
    ],
    filtered: [
      ...knownBrokenOptions.map((option) => ({
        player: option.player.label,
        reason: "known_broken_url" as const,
        url: option.access.url,
      })),
      ...checks
        .filter((check) => check.broken)
        .map((check) => ({
          player: check.option.player.label,
          reason: "player_validation_failed" as const,
          url: check.option.access.url,
        })),
    ],
  };
}

function emitPlayerAudit(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  discovered: string[],
  shown: StreamOption[],
  filtered: KinoBdFilteredPlayerAuditEntry[],
): void {
  try {
    config.onPlayerAudit?.({
      query: {
        ...query,
        ...(query.ids ? { ids: { ...query.ids } } : {}),
        ...(query.providers ? { providers: [...query.providers] } : {}),
      },
      discovered: [...new Set(discovered)],
      shown: [...new Set(shown.map((option) => option.player.label))],
      filtered,
    });
  } catch {
    // Diagnostics must not change availability behavior.
  }
}

async function isBrokenPlayerUrl(
  config: KinoBdStreamingConfig,
  url: string,
  context: ProviderContext,
  depth = 0,
): Promise<boolean> {
  const fetchImpl = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.playerValidationTimeoutMs);

  try {
    if (context.signal?.aborted) {
      return false;
    }

    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (response.status === 404 || response.status === 410 || response.status >= 500) {
      return true;
    }

    if (!response.ok) {
      return false;
    }

    const html = await response.text();

    if (hasBrokenPlayerMarker(html)) {
      return true;
    }

    const nestedUrl = depth < PLAYER_VALIDATION_MAX_DEPTH ? extractIframeUrl(html, url) : undefined;

    return nestedUrl ? isBrokenPlayerUrl(config, nestedUrl, context, depth + 1) : false;
  } catch {
    return isKnownBrokenPlayerUrl(url);
  } finally {
    clearTimeout(timeout);
  }
}

function isKnownBrokenPlayerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      /(^|\.)sevstar\d*krop\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/iframe")
    );
  } catch {
    return false;
  }
}

function hasBrokenPlayerMarker(html: string): boolean {
  const normalized = normalizeSearchText(html);

  return (
    normalized.includes("video not found") ||
    normalized.includes("404 not found") ||
    normalized.includes("плеер недоступ") ||
    normalized.includes("плеєр недоступ") ||
    normalized.includes("недоступний для перегляду") ||
    normalized.includes("змініть країну перегляду")
  );
}

// Maps search-result iframes into fallback player options when /playerdata cannot be used.
// Мапит iframe из search results в fallback player options, когда /playerdata недоступен.
function mapCandidatesToFallbackOptions(
  providerName: string,
  candidates: PlayerCandidate[],
  query: MediaAvailability["query"],
): StreamOption[] {
  return candidates
    .map((candidate) => {
      const iframe = extractIframeUrl(candidate.iframe, undefined);

      if (!iframe) {
        return undefined;
      }

      const title =
        candidate.title?.trim() ||
        candidate.name_russian?.trim() ||
        candidate.name_original?.trim() ||
        "KinoBD";
      const fallbackKey = `KINOBD>${title}`;

      return mapPayloadToOption(
        providerName,
        fallbackKey,
        {
          translate: title,
          iframe,
          quality: "auto",
          source: "kinobd",
        },
        candidate,
        query,
      );
    })
    .filter((option): option is StreamOption => Boolean(option));
}

// Maps one player payload into one stream option.
// Мапит один player payload в один stream option.
function mapPayloadToOption(
  providerName: string,
  providerKey: string,
  payload: PlayerPayload,
  candidate: PlayerCandidate | undefined,
  query: MediaAvailability["query"],
): StreamOption | undefined {
  const iframe = extractIframeUrl(payload.iframe, undefined);

  if (!iframe) {
    return undefined;
  }

  const label = normalizeProviderLabel(providerKey);
  const translationTitle = payload.translate?.trim() || label;
  const qualityLabel = payload.quality?.trim() || "auto";

  return {
    id: [
      providerName,
      label.toLowerCase(),
      candidate?.id ?? candidate?.inid ?? query.ids?.shikimori ?? query.title ?? "item",
      query.seasonNumber ?? "s",
      query.episodeNumber ?? "e",
      query.absoluteEpisodeNumber ?? "a",
    ]
      .join(":")
      .replace(/\s+/g, "-"),
    provider: providerName,
    player: {
      kind: "embed",
      label,
      providerPlayerId: providerKey,
    },
    translation: createTranslationInfo(translationTitle),
    quality: {
      label: qualityLabel,
      height: parseQualityHeight(qualityLabel),
    },
    episode: hasEpisodeQuery(query)
      ? {
          seasonNumber: query.seasonNumber,
          episodeNumber: query.episodeNumber,
          absoluteEpisodeNumber: query.absoluteEpisodeNumber,
        }
      : undefined,
    access: {
      url: iframe,
    },
    availability: payload.warning ? "unknown" : "available",
    sourceUrl: iframe,
  };
}

// Creates an empty availability response without failing metadata flows.
// Создает пустой availability response без поломки metadata flows.
function createEmptyAvailability(query: MediaAvailability["query"]): MediaAvailability {
  return {
    query,
    options: [],
    sourceProviders: [],
    checkedAt: new Date().toISOString(),
  };
}

// Collects known external IDs from a player candidate.
// Собирает известные external IDs из player candidate.
function collectCandidateIds(candidate: PlayerCandidate | undefined): ExternalIds | undefined {
  if (!candidate) {
    return undefined;
  }

  const ids: ExternalIds = {};
  const kinopoiskId = candidate.kinopoisk_id ?? candidate.kp_id;

  if (kinopoiskId !== undefined && kinopoiskId !== null) {
    ids.kinopoisk = String(kinopoiskId);
  }

  if (candidate.imdb_id) {
    ids.imdb = candidate.imdb_id;
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
}

// Extracts either raw URL or iframe src/data-src value.
// Извлекает raw URL или iframe src/data-src значение.
function extractIframeUrl(
  value: string | null | undefined,
  baseUrl: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("//")) {
    return toAbsoluteUrl(trimmed, baseUrl);
  }

  const dataSrcMatch = /data-src="([^"]+)"/i.exec(trimmed);

  if (dataSrcMatch?.[1]) {
    return toAbsoluteUrl(dataSrcMatch[1], baseUrl);
  }

  const srcMatch = /src="([^"]+)"/i.exec(trimmed);

  if (srcMatch?.[1]) {
    return toAbsoluteUrl(srcMatch[1], baseUrl);
  }

  return undefined;
}

// Normalizes absolute, protocol-relative, or relative URLs.
// Нормализует absolute, protocol-relative или relative URLs.
function toAbsoluteUrl(value: string, baseUrl: string | undefined): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  if (baseUrl) {
    return new URL(value, `${baseUrl}/`).toString();
  }

  return value;
}

// Checks whether query contains episode targeting fields.
// Проверяет, содержит ли query поля выбора эпизода.
function hasEpisodeQuery(query: MediaAvailability["query"]): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
}

// Converts provider map keys into display labels.
// Преобразует provider map keys в display labels.
function normalizeProviderLabel(providerKey: string): string {
  return providerKey.split(">")[0]?.trim().toUpperCase() || "PLAYER";
}

function createTranslationInfo(title: string): TranslationInfo {
  const team = inferTranslationTeam(title);

  return {
    title,
    type: inferTranslationType(title),
    language: inferTranslationLanguage(title),
    ...(team ? { team } : {}),
  };
}

function inferTranslationType(title: string): TranslationInfo["type"] {
  const normalized = normalizeSearchText(title);

  if (/\b(sub|subs|subtitle|subtitles)\b/.test(normalized) || normalized.includes("субтит")) {
    return "subtitles";
  }

  if (/\b(original|orig)\b/.test(normalized) || normalized.includes("оригинал")) {
    return "original";
  }

  if (/\b(dub|dubbed|dubbing)\b/.test(normalized) || normalized.includes("дубл")) {
    return "dub";
  }

  if (
    /\b(voice|voiceover)\b/.test(normalized) ||
    normalized.includes("озвуч") ||
    normalized.includes("закадр") ||
    normalized.includes("одноголос") ||
    normalized.includes("многоголос") ||
    normalized.includes("любител") ||
    normalized.includes("профессион") ||
    hasKnownRussianVoiceoverTeam(normalized)
  ) {
    return "voiceover";
  }

  return "unknown";
}

function inferTranslationLanguage(title: string): string | undefined {
  const normalized = normalizeSearchText(title);

  if (
    /[іїєґ]/i.test(title) ||
    normalized.includes("украин") ||
    normalized.includes("україн") ||
    normalized.includes("професій") ||
    normalized.includes("дубльований") ||
    normalized.includes("багатоголос") ||
    normalized.includes("закадровий") ||
    /\b(uateam|dniprofilm)\b/.test(normalized)
  ) {
    return "uk";
  }

  if (/\b(eng|english)\b/.test(normalized) || normalized.includes("англ")) {
    return "en";
  }

  if (/[а-яё]/i.test(title) || hasKnownRussianVoiceoverTeam(normalized)) {
    return "ru";
  }

  return undefined;
}

function inferTranslationTeam(title: string): string | undefined {
  const normalized = normalizeSearchText(title);

  return KNOWN_RUSSIAN_VOICEOVER_TEAMS.find((team) =>
    normalized.includes(normalizeSearchText(team)),
  );
}

function hasKnownRussianVoiceoverTeam(normalizedTitle: string): boolean {
  return KNOWN_RUSSIAN_VOICEOVER_TEAMS.some((team) =>
    normalizedTitle.includes(normalizeSearchText(team)),
  );
}

function parsePlayerProviderKeys(playerProviders: string): ReadonlySet<string> {
  return new Set(
    playerProviders
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider) => provider && !BLOCKED_PLAYER_PROVIDERS.has(provider)),
  );
}

function isAllowedPlayerProvider(
  providerKey: string,
  allowedPlayerProviders: ReadonlySet<string>,
): boolean {
  const key = providerKey.split(">")[0]?.trim().toLowerCase();

  return Boolean(key && allowedPlayerProviders.has(key));
}

// Parses common quality labels like 720p or 1080p.
// Парсит распространенные quality labels вроде 720p или 1080p.
function parseQualityHeight(label: string): number | undefined {
  const match = /(\d{3,4})p?/i.exec(label);

  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

// Parses optional integer-like values.
// Парсит опциональные integer-like значения.
function parseOptionalInteger(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  return Number.isInteger(parsed) ? parsed : undefined;
}

// Parses a year from date-like values such as 2002-10-03.
// Парсит год из date-like значений вроде 2002-10-03.
function parseYear(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);

  return Number.isInteger(year) ? year : undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Validates and normalizes provider name.
// Проверяет и нормализует имя provider.
function normalizeProviderName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new TypeError("KinoBD streaming provider name is required.");
  }

  return normalized;
}

// Removes trailing slashes from base URLs.
// Убирает trailing slashes из base URLs.
function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new TypeError("KinoBD streaming baseUrl is required.");
  }

  return trimmed.replace(/\/+$/, "");
}
