import type { ExternalIds, MediaAvailability, ProviderContext } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { fetchJson } from "../shared/index.js";
import { mapKinoBdMediaType as mapCandidateMediaType } from "../shared/mapping.js";
import type { KinoBdStreamingConfig } from "./config.js";

// Search response returned by KinoBD-style player lookup.
// Search response, который возвращает KinoBD-style player lookup.
interface PlayerSearchResponse {
  data?: PlayerCandidate[];
}

// Candidate item used to request concrete provider players through /playerdata.
// Candidate item для запроса конкретных provider players через /playerdata.
export interface PlayerCandidate {
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

// Minimal Shikimori payload used only to resolve a Shikimori ID into a title fallback.
// Минимальный payload Shikimori только для резолва Shikimori ID в title fallback.
interface ShikimoriAnimeLookup {
  name?: string | null;
  russian?: string | null;
  english?: string[] | null;
  aired_on?: string | null;
}

const MAX_ANIME_TITLE_FALLBACKS = 3;

// Builds bounded anime title fallbacks that KinoBD player search can understand.
// Собирает ограниченные anime title fallbacks, которые понимает KinoBD player search.
export async function createAnimeTitleFallbackQueries(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<MediaAvailability["query"][]> {
  const lookup = query.ids?.shikimori
    ? await tryLookupShikimoriAnime(config, query.ids.shikimori, context)
    : undefined;
  const lookupTitles = [lookup?.russian, lookup?.name, ...(lookup?.english ?? [])];
  const candidates = query.title
    ? [
        ...createBroaderAnimeTitles(query.title),
        ...lookupTitles.flatMap((title) => createBroaderAnimeTitles(title)),
        ...lookupTitles,
      ]
    : lookupTitles.flatMap((title) => [title, ...createBroaderAnimeTitles(title)]);
  const seen = new Set(query.title ? [normalizeSearchText(query.title)] : []);
  const fallbacks: MediaAvailability["query"][] = [];

  for (const candidate of candidates) {
    const title = candidate?.trim();
    const normalized = normalizeSearchText(title ?? "");

    if (!title || !normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    fallbacks.push({
      ...query,
      title,
      year: query.year ?? parseYear(lookup?.aired_on),
    });

    if (fallbacks.length === MAX_ANIME_TITLE_FALLBACKS) {
      break;
    }
  }

  return fallbacks;
}

// Searches KinoBD player candidates by Kinopoisk ID or title.
// Ищет KinoBD player candidates по Kinopoisk ID или title.
export async function searchPlayerCandidates(
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
    rateLimitGate: config.rateLimitGate,
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
export function selectBestPlayerCandidate(
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

// Collects known external IDs from a player candidate.
// Собирает известные external IDs из player candidate.
export function collectCandidateIds(
  candidate: PlayerCandidate | undefined,
): ExternalIds | undefined {
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

export function getCandidateStartYear(candidate: PlayerCandidate): number | undefined {
  return parseOptionalInteger(candidate.year ?? candidate.year_start);
}

function scorePlayerCandidate(
  candidate: PlayerCandidate,
  query: MediaAvailability["query"],
  normalizedTitle: string,
): number {
  const candidateType = mapCandidateMediaType(candidate.type);
  const queryType =
    query.type === "anime"
      ? "series"
      : query.type === "movie" || query.type === "series"
        ? query.type
        : undefined;

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
      const outsideKnownRange =
        endYear !== undefined
          ? query.year < startYear || query.year > endYear
          : isOpenEndedYear(candidate.year_end)
            ? query.year < startYear
            : query.year !== startYear;

      if (outsideKnownRange) {
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
      rateLimitGate: config.rateLimitGate,
      maxRetries: 0,
      init: {
        headers,
      },
    });
  } catch (error) {
    rethrowIfProviderAborted(context, error);
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

// Produces conservative franchise/base-title variants for separately catalogued anime seasons.
// Создает консервативные варианты франшизы/base title для отдельно каталогизированных сезонов anime.
function createBroaderAnimeTitles(value: string | null | undefined): string[] {
  const title = value?.trim();

  if (!title) {
    return [];
  }

  const variants: string[] = [];
  const franchisePrefix = title.split(/\.\s+|\s+[-–—]\s*/u, 1)[0]?.trim();

  if (
    franchisePrefix &&
    franchisePrefix.length >= 5 &&
    franchisePrefix.length <= 48 &&
    /[:!?]/u.test(franchisePrefix) &&
    normalizeSearchText(franchisePrefix) !== normalizeSearchText(title)
  ) {
    variants.push(franchisePrefix);
  }

  const withoutEnglishSeason = title
    .replace(
      /\s+(?:(?:\d+(?:st|nd|rd|th)\s+season)|(?:season\s+\d+))(?:\s+(?:part|cour)\s+\d+)?\s*$/iu,
      "",
    )
    .trim();
  const withoutRussianSeason = withoutEnglishSeason
    .replace(/\s+\d+(?:-?[а-я]+)?\s+сезон\s*$/iu, "")
    .trim();
  const withoutTrailingSeasonNumber =
    withoutRussianSeason.split(/\s+/u).length >= 5
      ? withoutRussianSeason.replace(/\s+\d+\s*$/u, "").trim()
      : withoutRussianSeason;

  if (normalizeSearchText(withoutTrailingSeasonNumber) !== normalizeSearchText(title)) {
    variants.push(withoutTrailingSeasonNumber);
  }

  return variants;
}

// Distinguishes an explicitly ongoing range from a record that only has one known year.
// Отличает явно продолжающийся диапазон от записи, у которой известен только один год.
function isOpenEndedYear(value: string | number | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return /^(?:\.{3}|…|present|ongoing|now|н\.?\s*в\.?)$/iu.test(value.trim());
}

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
