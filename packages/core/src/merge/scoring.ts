import type {
  SearchQuery,
  SearchRankEvidence,
  SearchRankSignal,
  SearchTitleMatchKind,
} from "../search/index.js";
import { hasSharedStrongId } from "./identity.js";
import type { SearchEntry, SearchGroup } from "./internal.js";
import { normalizeTitle, titleCandidates } from "./title.js";
import type { MergeContext } from "./types.js";

// Calculates a public score from match strength, query relevance, and popularity signals.
// Вычисляет публичную оценку по силе совпадения, релевантности запросу и популярности.
export function scoreGroup(
  group: SearchGroup,
  entries: SearchEntry[],
  context: MergeContext,
): number {
  return rankSearchGroup(group, entries, context).score;
}

// Calculates the public score and its debug explanation from the same normalized signals.
// Вычисляет публичный score и его debug-объяснение из одних и тех же сигналов.
export function rankSearchGroup(
  group: SearchGroup,
  entries: SearchEntry[],
  context: MergeContext,
): {
  score: number;
  evidence: Omit<
    SearchRankEvidence,
    "scorePosition" | "diversityPosition" | "finalPosition" | "diversity"
  >;
} {
  const query = context.query as SearchQuery | undefined;
  const queryIds = "ids" in (query ?? {}) ? query?.ids : undefined;
  const queryTitle = "title" in (query ?? {}) ? query?.title : undefined;

  if (queryIds && entries.some((entry) => hasSharedStrongId(queryIds, entry.result.item.ids))) {
    return createRankResult("external_id", group, 1, emptyTitleMatch(), {
      base: signal(1, 1),
    });
  }

  if (!queryTitle?.trim()) {
    const baseScore = baseGroupScore(group, entries);
    return createRankResult("non_text", group, baseScore, emptyTitleMatch(), {
      base: signal(baseScore, 1),
    });
  }

  const baseScore = baseTextSearchScore(group, entries);
  const titleMatch = titleRelevanceEvidence(entries, queryTitle);
  const titleScore = titleMatch.score;
  const exactPrimaryTitleScore = hasExactPrimaryTitle(entries, queryTitle) ? 1 : 0;
  const popularityScore = ratingVotesScore(entries);
  const ratingScore = normalizedRatingScore(entries);
  const idScore = externalIdCompletenessScore(entries);
  const sourceScore = sourceCoverageScore(entries);
  const authorityScore = sourceAuthorityScore(entries);

  const signals = {
    base: signal(baseScore, 1),
    title: signal(titleScore, 0.2),
    // Prefer exact primary/original intent over prefix and incidental-alias noise while
    // still allowing overwhelmingly corroborated canonical results for broad short queries.
    exactPrimaryTitle: signal(exactPrimaryTitleScore, 0.3),
    popularity: signal(popularityScore, 0.15),
    rating: signal(ratingScore, 0.03),
    externalIds: signal(idScore, 0.2),
    sourceCoverage: signal(sourceScore, 0.02),
    sourceAuthority: signal(authorityScore, 0.1),
  };
  const preBoundedScore = Object.values(signals).reduce(
    (total, rankingSignal) => total + rankingSignal.contribution,
    0,
  );

  return createRankResult("text", group, boundedTextScore(preBoundedScore), titleMatch, signals);
}

// Distinguishes exact primary/original titles from incidental alternative aliases.
// Отличает точные основные/оригинальные названия от случайных alternative aliases.
export function hasExactPrimaryTitle(entries: SearchEntry[], queryTitle: string): boolean {
  const normalizedQuery = normalizeTitle(queryTitle);

  return entries.some((entry) =>
    [entry.result.item.title, entry.result.item.originalTitle]
      .filter((title): title is string => Boolean(title))
      .some((title) => normalizeTitle(title) === normalizedQuery),
  );
}

// Scores how well result titles match the user's text query.
// Оценивает, насколько названия результатов совпадают с текстовым запросом пользователя.
export function titleRelevanceScore(entries: SearchEntry[], queryTitle: string): number {
  return titleRelevanceEvidence(entries, queryTitle).score;
}

// Returns the strongest deterministic title match used by ranking and debug evidence.
// Возвращает сильнейшее детерминированное title match для ranking и debug evidence.
export function titleRelevanceEvidence(
  entries: SearchEntry[],
  queryTitle: string,
): { kind: SearchTitleMatchKind; score: number; matchedTitle?: string } {
  const normalizedQuery = normalizeTitle(queryTitle);

  if (!normalizedQuery) {
    return emptyTitleMatch();
  }

  let best: SearchRankEvidence["titleMatch"] = { kind: "none", score: 0 };

  for (const entry of entries) {
    const primaryTitles = new Set(
      [entry.result.item.title, entry.result.item.originalTitle]
        .filter((title): title is string => Boolean(title))
        .map(normalizeTitle),
    );

    for (const title of titleCandidates(entry.result.item)) {
      const match = scoreNormalizedTitle(normalizeTitle(title), normalizedQuery);

      if (match.score > best.score) {
        best = {
          kind:
            match.kind === "exact"
              ? primaryTitles.has(normalizeTitle(title))
                ? "exact_primary"
                : "exact_alias"
              : match.kind,
          score: match.score,
          matchedTitle: title,
        };
      }
    }
  }

  return best;
}

// Keeps legacy scores for non-title searches where no relevance ranking is possible.
// Сохраняет прежние оценки для поиска без title, где нельзя посчитать релевантность.
function baseGroupScore(group: SearchGroup, entries: SearchEntry[]): number {
  switch (group.matchStrength) {
    case "exact_id":
      return 1;
    case "exact_title_year_type":
      return 0.9;
    case "normalized_title_year_type":
      return 0.8;
    case "weak":
      return 0.4;
    case "none":
      return clampScore(entries[0]?.result.confidence ?? 0.5);
  }
}

// Starts text-search scoring below 1 so popularity and relevance can break exact-ID ties.
// Начинает оценку текстового поиска ниже 1, чтобы популярность и релевантность разбивали tie по ID.
function baseTextSearchScore(group: SearchGroup, entries: SearchEntry[]): number {
  switch (group.matchStrength) {
    case "exact_id":
      return 0.44 + bestProviderConfidence(entries) * 0.18;
    case "exact_title_year_type":
      return 0.62;
    case "normalized_title_year_type":
      return 0.52;
    case "weak":
      return 0.25;
    case "none":
      return bestProviderConfidence(entries) * 0.45;
  }
}

// Uses the strongest provider confidence inside a merged group.
// Использует самый сильный confidence провайдера внутри объединенной группы.
function bestProviderConfidence(entries: SearchEntry[]): number {
  return Math.max(...entries.map((entry) => clampScore(entry.result.confidence ?? 0.5)));
}

// Scores one normalized title against one normalized query.
// Оценивает одно нормализованное название против одного нормализованного запроса.
function scoreNormalizedTitle(
  title: string,
  query: string,
): {
  kind: Exclude<SearchTitleMatchKind, "not_applicable" | "exact_primary" | "exact_alias"> | "exact";
  score: number;
} {
  if (!title) {
    return { kind: "none", score: 0 };
  }

  if (title === query) {
    return { kind: "exact", score: 1 };
  }

  if (title.replace(/\s+/g, "") === query.replace(/\s+/g, "")) {
    return { kind: "joined", score: 0.98 };
  }

  if (title.startsWith(`${query} `)) {
    return { kind: "prefix", score: adjustPartialTitleScore(0.92, title, query) };
  }

  if (title.includes(` ${query} `) || title.endsWith(` ${query}`)) {
    return { kind: "contains", score: adjustPartialTitleScore(0.75, title, query) };
  }

  const queryTokens = query.split(" ").filter(Boolean);

  if (queryTokens.length > 0 && queryTokens.every((token) => title.includes(token))) {
    return { kind: "all_tokens", score: adjustPartialTitleScore(0.55, title, query) };
  }

  const titleTokens = title.split(" ").filter(Boolean);
  const fuzzyTokenScores = queryTokens.map((queryToken) =>
    Math.max(...titleTokens.map((titleToken) => fuzzyTokenSimilarity(queryToken, titleToken)), 0),
  );
  const minimumFuzzyScore = queryTokens.length >= 3 ? 0.7 : 0.75;

  if (
    fuzzyTokenScores.length > 0 &&
    fuzzyTokenScores.every((score) => score >= minimumFuzzyScore)
  ) {
    return {
      kind: "fuzzy",
      score: adjustPartialTitleScore(
        (fuzzyTokenScores.reduce((sum, score) => sum + score, 0) / fuzzyTokenScores.length) * 0.7,
        title,
        query,
      ),
    };
  }

  return { kind: "none", score: 0 };
}

type RankSignals = SearchRankEvidence["signals"];

function createRankResult(
  formula: SearchRankEvidence["formula"],
  group: SearchGroup,
  score: number,
  titleMatch: SearchRankEvidence["titleMatch"],
  partialSignals: Partial<RankSignals>,
): {
  score: number;
  evidence: Omit<
    SearchRankEvidence,
    "scorePosition" | "diversityPosition" | "finalPosition" | "diversity"
  >;
} {
  const zero = signal(0, 0);
  const signals: RankSignals = {
    base: partialSignals.base ?? zero,
    title: partialSignals.title ?? zero,
    exactPrimaryTitle: partialSignals.exactPrimaryTitle ?? zero,
    popularity: partialSignals.popularity ?? zero,
    rating: partialSignals.rating ?? zero,
    externalIds: partialSignals.externalIds ?? zero,
    sourceCoverage: partialSignals.sourceCoverage ?? zero,
    sourceAuthority: partialSignals.sourceAuthority ?? zero,
  };

  return {
    score,
    evidence: {
      formula,
      matchStrength: group.matchStrength,
      titleMatch,
      signals,
      preBoundedScore: Object.values(signals).reduce(
        (total, rankingSignal) => total + rankingSignal.contribution,
        0,
      ),
    },
  };
}

function signal(value: number, weight: number): SearchRankSignal {
  return { value, weight, contribution: value * weight };
}

function emptyTitleMatch(): SearchRankEvidence["titleMatch"] {
  return { kind: "not_applicable", score: 0 };
}

// Prefers the closest title completion for multi-word prefix and fuzzy matches.
// Предпочитает ближайшее продолжение title для multi-word prefix и fuzzy matches.
function adjustPartialTitleScore(score: number, title: string, query: string): number {
  const queryTokenCount = query.split(" ").filter(Boolean).length;

  if (queryTokenCount < 2) {
    return score;
  }

  const titleTokenCount = title.split(" ").filter(Boolean).length;
  const tokenRatio =
    Math.min(queryTokenCount, titleTokenCount) / Math.max(queryTokenCount, titleTokenCount);

  return score * (0.5 + tokenRatio * 0.5);
}

// Allows one small typo in meaningful words while keeping short tokens exact.
// Допускает одну небольшую опечатку в значимых словах, сохраняя короткие токены точными.
function fuzzyTokenSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (Math.min(left.length, right.length) < 4) {
    return 0;
  }

  if (isSingleAdjacentTransposition(left, right)) {
    return 1 - 1 / Math.max(left.length, right.length);
  }

  const variants = [right, ...(right.endsWith("s") ? [right.slice(0, -1)] : [])];
  const distance = Math.min(
    ...variants
      .filter((variant) => Math.abs(left.length - variant.length) <= 1)
      .map((variant) => levenshteinDistance(left, variant, 1)),
  );

  if (distance <= 1) {
    return 1 - distance / Math.max(left.length, right.length);
  }

  if (Math.min(left.length, right.length) >= 6 && isTranspositionPlusOneEdit(left, right)) {
    return 1 - 2 / Math.max(left.length, right.length);
  }

  return 0;
}

// Allows one adjacent swap plus one insertion, deletion, or substitution in long words.
// Допускает перестановку соседних символов и еще одну правку в длинных словах.
function isTranspositionPlusOneEdit(left: string, right: string): boolean {
  for (let index = 0; index < right.length - 1; index += 1) {
    const swapped =
      right.slice(0, index) + right[index + 1] + right[index] + right.slice(index + 2);

    if (Math.abs(left.length - swapped.length) <= 1 && levenshteinDistance(left, swapped, 1) <= 1) {
      return true;
    }
  }

  return false;
}

// Recognizes a single swapped adjacent character, a common typing error Levenshtein counts as two.
// Распознает перестановку соседних символов, которую Levenshtein считает двумя ошибками.
function isSingleAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let firstDifference = -1;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }

    if (firstDifference !== -1) {
      return (
        index === firstDifference + 1 &&
        left[firstDifference] === right[index] &&
        left[index] === right[firstDifference] &&
        left.slice(index + 1) === right.slice(index + 1)
      );
    }

    firstDifference = index;
  }

  return false;
}

function levenshteinDistance(left: string, right: string, maxDistance: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length] ?? maxDistance + 1;
}

// Scores popularity from the largest available vote count.
// Оценивает популярность по самому большому доступному числу голосов.
function ratingVotesScore(entries: SearchEntry[]): number {
  const maxVotes = maxRatingVotes(entries);

  return Math.min(1, Math.max(0, (Math.log10(maxVotes + 1) - 3) / 4));
}

// Scores normalized rating values across providers.
// Оценивает нормализованные значения рейтингов от провайдеров.
function normalizedRatingScore(entries: SearchEntry[]): number {
  const values = entries.flatMap(
    (entry) =>
      entry.result.item.ratings
        ?.map((rating) => {
          const value = rating.value / rating.max;
          return value * ratingVoteConfidence(rating.votes);
        })
        .filter((value) => Number.isFinite(value)) ?? [],
  );

  return values.length === 0 ? 0 : Math.max(...values.map((value) => clampScore(value)));
}

// Rewards results that carry strong external IDs for better follow-up details lookup.
// Поощряет результаты с сильными внешними ID для более надежной загрузки деталей.
function externalIdCompletenessScore(entries: SearchEntry[]): number {
  const ids = entries.map((entry) => entry.result.item.ids);
  const hasCatalogAnimeId = ids.some(
    (value) => value?.shikimori || value?.myAnimeList || value?.aniList,
  );
  const animeCatalogScore = hasCatalogAnimeId ? (maxRatingVotes(entries) >= 100_000 ? 1 : 0.5) : 0;

  return Math.max(
    0,
    ids.some((value) => value?.imdb) ? 1 : 0,
    ids.some((value) => value?.kinopoisk) ? 0.9 : 0,
    ids.some((value) => value?.tmdb) ? 0.8 : 0,
    animeCatalogScore,
    ids.some((value) => value?.worldArt) ? 0.3 : 0,
  );
}

function maxRatingVotes(entries: SearchEntry[]): number {
  return Math.max(
    0,
    ...entries.flatMap(
      (entry) => entry.result.item.ratings?.map((rating) => rating.votes ?? 0) ?? [],
    ),
  );
}

function ratingVoteConfidence(votes: number | undefined): number {
  if (votes === undefined) {
    return 0.2;
  }

  if (votes < 1_000) {
    return 0.3;
  }

  if (votes < 100_000) {
    return 0.6;
  }

  return 1;
}

// Rewards results confirmed by multiple providers.
// Поощряет результаты, подтвержденные несколькими провайдерами.
function sourceCoverageScore(entries: SearchEntry[]): number {
  return Math.min(1, new Set(entries.map((entry) => entry.result.provider)).size / 3);
}

// Adds a small authority signal for sources that usually imply broader popularity.
// Добавляет небольшой сигнал авторитетности для источников, которые обычно отражают популярность.
function sourceAuthorityScore(entries: SearchEntry[]): number {
  const providers = [...new Set(entries.map((entry) => entry.result.provider))];

  return (
    providers.reduce((total, provider) => total + providerAuthority(provider), 0) /
    Math.max(1, providers.length)
  );
}

// Scores provider authority for broad text search ranking.
// Оценивает авторитетность провайдера для ранжирования широкого текстового поиска.
function providerAuthority(provider: string): number {
  switch (provider) {
    case "wikidata":
      return 0.9;
    case "tmdb":
      return 0.95;
    case "cinemeta":
      return 0.75;
    case "kinobd":
      return 0.75;
    case "imdb":
      return 0.65;
    case "kinopoisk":
      return 0.6;
    case "shikimori":
      return 0.9;
    case "anilist":
      return 0.9;
    default:
      return 0.3;
  }
}

// Keeps text-search scores comparable without flattening many strong matches to exactly 1.
// Сохраняет сравнимость text-search score без схлопывания сильных совпадений ровно в 1.
function boundedTextScore(score: number): number {
  return 0.5 + clampScore(score / (score + 1)) * 0.5;
}

// Restricts a score value to the public 0..1 range.
// Ограничивает значение score публичным диапазоном 0..1.
function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}
