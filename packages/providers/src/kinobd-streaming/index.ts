import type {
  MediaAvailability,
  ProviderContext,
  StreamOption,
  StreamingProvider,
  TranslationInfo,
} from "@media-engine/core";
import { fetchJson, normalizePublicHttpUrl } from "../shared/index.js";
import {
  createCapabilities,
  createConfig,
  type KinoBdFilteredPlayerAuditEntry,
  type KinoBdStreamingConfig,
  type KinoBdStreamingProviderOptions,
} from "./config.js";
import {
  collectCandidateIds,
  createAnimeTitleFallbackQuery,
  getCandidateStartYear,
  normalizeSearchText,
  type PlayerCandidate,
  searchPlayerCandidates,
  selectBestPlayerCandidate,
} from "./candidates.js";

export type {
  KinoBdFilteredPlayerAuditEntry,
  KinoBdPlayerAudit,
  KinoBdPlayerFilterReason,
  KinoBdStreamingProviderOptions,
} from "./config.js";

const PLAYER_VALIDATION_MAX_DEPTH = 1;
const PLAYER_VALIDATION_MAX_BODY_BYTES = 256 * 1024;
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

interface PlayerOptionMapping {
  options: StreamOption[];
  discovered: string[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

interface PlayerOptionFilterResult {
  options: StreamOption[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
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

  const options = await loadPlayerOptions(config, selected, query, context);

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
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;

  try {
    if (context.signal?.aborted) {
      return false;
    }

    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal,
    });

    if (response.status === 404 || response.status === 410 || response.status >= 500) {
      return true;
    }

    if (!response.ok) {
      return false;
    }

    const html = await readBoundedResponseText(response, PLAYER_VALIDATION_MAX_BODY_BYTES);

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

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes <= maxBytes) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

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
function toAbsoluteUrl(value: string, baseUrl: string | undefined): string | undefined {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return normalizePublicHttpUrl(value);
  }

  if (value.startsWith("//")) {
    return normalizePublicHttpUrl(`https:${value}`);
  }

  if (baseUrl) {
    return normalizePublicHttpUrl(new URL(value, `${baseUrl}/`).toString());
  }

  return undefined;
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
  const type = inferTranslationType(title);

  return {
    title,
    type,
    language: inferTranslationLanguage(title, type),
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

function inferTranslationLanguage(
  title: string,
  type: TranslationInfo["type"],
): string | undefined {
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

  if (/\b(ru|rus|russian)\b/.test(normalized) || normalized.includes("русск")) {
    return "ru";
  }

  if (hasKnownRussianVoiceoverTeam(normalized)) {
    return "ru";
  }

  // A Cyrillic UI label alone does not prove the language of original audio or subtitles.
  // Кириллическая подпись сама по себе не доказывает язык оригинальной дорожки или субтитров.
  if (type !== "original" && type !== "subtitles" && /[а-яё]/i.test(title)) {
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
