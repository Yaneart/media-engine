import type {
  MediaAvailability,
  ProviderContext,
  StreamOption,
  TranslationInfo,
} from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl } from "../shared/index.js";
import type { KinoBdFilteredPlayerAuditEntry, KinoBdStreamingConfig } from "./config.js";
import { normalizeSearchText, type PlayerCandidate } from "./candidates.js";
import type { KinoBdRequestBudget } from "./request-budget.js";

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

export interface PlayerOptionMapping {
  options: StreamOption[];
  discovered: string[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

// Map of provider names to iframe player payloads.
// Map имен provider к payload iframe-плееров.
export type PlayerDataResponse = Record<string, PlayerPayload>;

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

// Loads provider iframe data for a selected candidate.
// Загружает provider iframe data для выбранного candidate.
export async function loadPlayerData(
  config: KinoBdStreamingConfig,
  candidate: PlayerCandidate,
  context: ProviderContext,
  budget: KinoBdRequestBudget,
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
    context: budget.createContext(context),
    fetch: budget.createFetch(config.name, config.fetch),
    rateLimitGate: config.rateLimitGate,
    init: {
      method: "POST",
      headers,
      body,
    },
  });
}

// Maps a provider player map into normalized stream options.
// Мапит provider player map в нормализованные stream options.
export function mapPlayerMapToOptions(
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

// Maps search-result iframes into fallback player options when /playerdata cannot be used.
// Мапит iframe из search results в fallback player options, когда /playerdata недоступен.
export function mapCandidatesToFallbackOptions(
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

// Extracts either raw URL or iframe src/data-src value.
// Извлекает raw URL или iframe src/data-src значение.
export function extractIframeUrl(
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

// Checks whether query contains episode targeting fields.
// Проверяет, содержит ли query поля выбора эпизода.
export function hasEpisodeQuery(query: MediaAvailability["query"]): boolean {
  return (
    query.seasonNumber !== undefined ||
    query.episodeNumber !== undefined ||
    query.absoluteEpisodeNumber !== undefined
  );
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

// Normalizes absolute, protocol-relative, or relative URLs.
// Нормализует absolute, protocol-relative или relative URLs.
function toAbsoluteUrl(value: string, baseUrl: string | undefined): string | undefined {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return normalizeProviderOutputUrl(value);
  }

  if (value.startsWith("//")) {
    return normalizeProviderOutputUrl(`https:${value}`);
  }

  if (baseUrl) {
    return normalizeProviderOutputUrl(new URL(value, `${baseUrl}/`).toString());
  }

  return undefined;
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
