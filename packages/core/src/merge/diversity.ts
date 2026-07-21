import type { MediaType } from "../media/index.js";
import type { SearchRankEvidence } from "../search/index.js";
import { normalizeTitle } from "./title.js";

const DIVERSITY_WINDOW_SIZE = 10;
const MAX_RESULTS_PER_FAMILY = 2;
const SCORE_TOLERANCE = 0.03;
const TITLE_SCORE_TOLERANCE = 0.05;

export interface RankedSearchCandidate<T> {
  value: T;
  score: number;
  mediaType: MediaType;
  title: string;
  ranking: Omit<
    SearchRankEvidence,
    "scorePosition" | "diversityPosition" | "finalPosition" | "diversity"
  >;
}

export interface DiversifiedSearchCandidate<T> extends RankedSearchCandidate<T> {
  scorePosition: number;
  diversityPosition: number;
  diversityFamily: string;
}

// Interleaves only similarly ranked title/type families inside a bounded leading window.
// Чередует только близкие по ranking title/type families внутри ограниченного верхнего окна.
export function diversifySearchCandidates<T>(
  candidates: RankedSearchCandidate<T>[],
  enabled: boolean,
): DiversifiedSearchCandidate<T>[] {
  const positioned = candidates.map((candidate, index) => ({
    ...candidate,
    scorePosition: index + 1,
    diversityFamily: createDiversityFamily(candidate),
  }));

  if (!enabled || positioned.length < MAX_RESULTS_PER_FAMILY + 1) {
    return positioned.map((candidate, index) => ({
      ...candidate,
      diversityPosition: index + 1,
    }));
  }

  const pending = positioned.slice(0, DIVERSITY_WINDOW_SIZE);
  const diversified: typeof positioned = [];
  const familyCounts = new Map<string, number>();

  while (pending.length > 0) {
    const crowded = pending[0]!;
    const crowdedCount = familyCounts.get(crowded.diversityFamily) ?? 0;
    const alternativeIndex =
      crowdedCount >= MAX_RESULTS_PER_FAMILY
        ? pending.findIndex(
            (candidate, index) =>
              index > 0 &&
              candidate.diversityFamily !== crowded.diversityFamily &&
              (familyCounts.get(candidate.diversityFamily) ?? 0) < MAX_RESULTS_PER_FAMILY &&
              isComparableCandidate(candidate, crowded),
          )
        : -1;
    const [selected] = pending.splice(alternativeIndex > 0 ? alternativeIndex : 0, 1);

    if (!selected) {
      break;
    }

    diversified.push(selected);
    familyCounts.set(
      selected.diversityFamily,
      (familyCounts.get(selected.diversityFamily) ?? 0) + 1,
    );
  }

  return [...diversified, ...positioned.slice(DIVERSITY_WINDOW_SIZE)].map((candidate, index) => ({
    ...candidate,
    diversityPosition: index + 1,
  }));
}

function createDiversityFamily<T>(candidate: RankedSearchCandidate<T>): string {
  const matchedTitle = candidate.ranking.titleMatch.matchedTitle ?? candidate.title;
  return `${candidate.mediaType}:${normalizeTitle(matchedTitle)}`;
}

function isComparableCandidate<T>(
  candidate: RankedSearchCandidate<T>,
  crowded: RankedSearchCandidate<T>,
): boolean {
  return (
    candidate.score >= crowded.score - SCORE_TOLERANCE &&
    candidate.ranking.titleMatch.score >= crowded.ranking.titleMatch.score - TITLE_SCORE_TOLERANCE
  );
}
