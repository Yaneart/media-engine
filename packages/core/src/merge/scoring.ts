import type { SearchQuery } from "../search/index.js";
import { hasSharedStrongId } from "./identity.js";
import type { SearchEntry, SearchGroup } from "./internal.js";
import { STRONG_ID_KEYS } from "./internal.js";
import { normalizeTitle, titleCandidates } from "./title.js";
import type { MergeContext } from "./types.js";

// Calculates a public score from match strength, query relevance, and popularity signals.
// Вычисляет публичную оценку по силе совпадения, релевантности запросу и популярности.
export function scoreGroup(
  group: SearchGroup,
  entries: SearchEntry[],
  context: MergeContext,
): number {
  const query = context.query as SearchQuery | undefined;
  const queryIds = "ids" in (query ?? {}) ? query?.ids : undefined;
  const queryTitle = "title" in (query ?? {}) ? query?.title : undefined;

  if (queryIds && entries.some((entry) => hasSharedStrongId(queryIds, entry.result.item.ids))) {
    return 1;
  }

  if (!queryTitle?.trim()) {
    return baseGroupScore(group, entries);
  }

  const baseScore = baseTextSearchScore(group, entries);
  const titleScore = titleRelevanceScore(entries, queryTitle);
  const exactPrimaryTitleScore = hasExactPrimaryTitle(entries, queryTitle) ? 1 : 0;
  const popularityScore = ratingVotesScore(entries);
  const ratingScore = normalizedRatingScore(entries);
  const idScore = externalIdCompletenessScore(entries);
  const sourceScore = sourceCoverageScore(entries);
  const authorityScore = sourceAuthorityScore(entries);

  return boundedTextScore(
    baseScore +
      titleScore * 0.2 +
      // Prefer exact primary/original intent over prefix and incidental-alias noise while
      // still allowing overwhelmingly corroborated canonical results for broad short queries.
      exactPrimaryTitleScore * 0.3 +
      popularityScore * 0.15 +
      ratingScore * 0.05 +
      idScore * 0.01 +
      sourceScore * 0.02 +
      authorityScore * 0.15,
  );
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
  const normalizedQuery = normalizeTitle(queryTitle);

  if (!normalizedQuery) {
    return 0;
  }

  return Math.max(
    ...entries.flatMap((entry) =>
      titleCandidates(entry.result.item).map((title) =>
        scoreNormalizedTitle(normalizeTitle(title), normalizedQuery),
      ),
    ),
  );
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
function scoreNormalizedTitle(title: string, query: string): number {
  if (!title) {
    return 0;
  }

  if (title === query) {
    return 1;
  }

  if (title.replace(/\s+/g, "") === query.replace(/\s+/g, "")) {
    return 0.98;
  }

  if (title.startsWith(`${query} `)) {
    return 0.92;
  }

  if (title.includes(` ${query} `) || title.endsWith(` ${query}`)) {
    return 0.75;
  }

  const queryTokens = query.split(" ").filter(Boolean);

  if (queryTokens.length > 0 && queryTokens.every((token) => title.includes(token))) {
    return 0.55;
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
    return (
      (fuzzyTokenScores.reduce((sum, score) => sum + score, 0) / fuzzyTokenScores.length) * 0.7
    );
  }

  return 0;
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
  const maxVotes = Math.max(
    0,
    ...entries.flatMap(
      (entry) => entry.result.item.ratings?.map((rating) => rating.votes ?? 0) ?? [],
    ),
  );

  return Math.min(1, Math.log10(maxVotes + 1) / 7);
}

// Scores normalized rating values across providers.
// Оценивает нормализованные значения рейтингов от провайдеров.
function normalizedRatingScore(entries: SearchEntry[]): number {
  const values = entries.flatMap(
    (entry) =>
      entry.result.item.ratings
        ?.map((rating) => rating.value / rating.max)
        .filter((value) => Number.isFinite(value)) ?? [],
  );

  return values.length === 0 ? 0 : Math.max(...values.map((value) => clampScore(value)));
}

// Rewards results that carry strong external IDs for better follow-up details lookup.
// Поощряет результаты с сильными внешними ID для более надежной загрузки деталей.
function externalIdCompletenessScore(entries: SearchEntry[]): number {
  const idCount = Math.max(
    0,
    ...entries.map(
      (entry) => STRONG_ID_KEYS.filter((key) => Boolean(entry.result.item.ids?.[key])).length,
    ),
  );

  return Math.min(1, idCount / 3);
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
      return 0.7;
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
