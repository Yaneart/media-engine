import type { RutubeMovieCandidate } from "./client.js";
import { normalizeProviderSearchText } from "../shared/mapping.js";

const MOVIE_CATEGORY_ID = 4;
const GENERIC_MOVIE_WORDS = new Set(["film", "movie", "фильм", "кино"]);

export function selectRutubeMovie(
  candidates: RutubeMovieCandidate[],
  title: string,
  year: number,
  minDurationSeconds: number,
): RutubeMovieCandidate | undefined {
  const normalizedTitle = normalizeProviderSearchText(title);
  if (!normalizedTitle) return undefined;

  return candidates.find(
    (candidate) =>
      isPublicMovie(candidate, minDurationSeconds) &&
      hasExactYear(candidate.title, year) &&
      normalizeCandidateTitle(candidate.title, year) === normalizedTitle,
  );
}

function isPublicMovie(candidate: RutubeMovieCandidate, minDurationSeconds: number): boolean {
  return (
    candidate.categoryId === MOVIE_CATEGORY_ID &&
    candidate.durationSeconds >= minDurationSeconds &&
    !candidate.hidden &&
    !candidate.deleted &&
    !candidate.adult &&
    !candidate.locked &&
    !candidate.audio &&
    !candidate.paid &&
    !candidate.livestream
  );
}

function hasExactYear(value: string, year: number): boolean {
  return new RegExp(`(?:^|\\D)${year}(?:\\D|$)`, "u").test(value);
}

function normalizeCandidateTitle(value: string, year: number): string {
  const words = normalizeProviderSearchText(value)
    .split(" ")
    .filter(Boolean)
    .filter((word) => word !== String(year));

  while (words.length > 0 && GENERIC_MOVIE_WORDS.has(words[0]!)) words.shift();
  while (words.length > 0 && GENERIC_MOVIE_WORDS.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}
