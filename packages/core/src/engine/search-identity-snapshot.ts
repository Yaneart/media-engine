import type { CacheSetOptions } from "../cache/index.js";
import type { MediaItem } from "../media/index.js";
import { hasSharedStrongId, hasStrongIdConflict } from "../merge/identity.js";
import { STRONG_ID_KEYS } from "../merge/internal.js";
import { normalizeTitle, titleCandidates } from "../merge/title.js";
import type { SearchIdentitySnapshotDebugMeta } from "../response/index.js";
import type { MediaSearchResult } from "../search/index.js";

const SEARCH_IDENTITY_SNAPSHOT_TTL_MS = 30 * 60_000;
const SEARCH_IDENTITY_SNAPSHOT_MAX_RESULTS = 20;

export interface SearchIdentitySnapshot {
  version: 2;
  results: MediaSearchResult[];
}

export interface SearchIdentitySnapshotRecovery {
  results: MediaSearchResult[];
  debug?: SearchIdentitySnapshotDebugMeta;
}

export const SEARCH_IDENTITY_SNAPSHOT_CACHE_OPTIONS: CacheSetOptions = {
  ttlMs: SEARCH_IDENTITY_SNAPSHOT_TTL_MS,
  staleTtlMs: 0,
};

// Keeps only a bounded prior known-good candidate list, not response metadata or cache state.
// Хранит только ограниченный список ранее подтвержденных кандидатов без response metadata.
export function createSearchIdentitySnapshot(
  results: MediaSearchResult[],
): SearchIdentitySnapshot | undefined {
  const topResult = results[0];

  if (!topResult || !STRONG_ID_KEYS.some((key) => Boolean(topResult.item.ids?.[key]))) {
    return undefined;
  }

  return {
    version: 2,
    results: structuredClone(results.slice(0, SEARCH_IDENTITY_SNAPSHOT_MAX_RESULTS)),
  };
}

// Restores known identities and order without treating conflicting strong IDs as one candidate.
// Восстанавливает identity и порядок, не объединяя кандидатов с конфликтующими strong ID.
export function recoverSearchIdentitySnapshot(
  currentResults: MediaSearchResult[],
  snapshot: SearchIdentitySnapshot | undefined,
): SearchIdentitySnapshotRecovery {
  if (!isUsableSearchIdentitySnapshot(snapshot)) {
    return { results: currentResults };
  }

  const recovered: MediaSearchResult[] = [];
  const usedCurrentIndexes = new Set<number>();
  let restored = 0;
  let reordered = 0;

  for (const snapshotResult of snapshot.results) {
    const currentIndex = currentResults.findIndex(
      (current, index) =>
        !usedCurrentIndexes.has(index) && isSameSearchIdentity(current.item, snapshotResult.item),
    );

    if (currentIndex !== -1) {
      usedCurrentIndexes.add(currentIndex);
      recovered.push(currentResults[currentIndex]!);

      if (currentIndex !== recovered.length - 1) {
        reordered += 1;
      }
      continue;
    }

    if (
      currentResults.some((current) =>
        hasConflictingSearchIdentity(current.item, snapshotResult.item),
      )
    ) {
      continue;
    }

    recovered.push(structuredClone(snapshotResult));
    restored += 1;
  }

  currentResults.forEach((result, index) => {
    if (!usedCurrentIndexes.has(index)) {
      recovered.push(result);
    }
  });

  if (restored === 0 && reordered === 0) {
    return { results: currentResults };
  }

  return {
    results: recovered,
    debug: {
      applied: true,
      restored,
      reordered,
    },
  };
}

export function isUsableSearchIdentitySnapshot(value: unknown): value is SearchIdentitySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<SearchIdentitySnapshot>;
  return snapshot.version === 2 && Array.isArray(snapshot.results) && snapshot.results.length > 0;
}

function isSameSearchIdentity(left: MediaItem, right: MediaItem): boolean {
  if (left.type !== right.type || hasStrongIdConflict(left.ids, right.ids)) {
    return false;
  }

  if (hasSharedStrongId(left.ids, right.ids)) {
    return true;
  }

  if (
    left.id === right.id &&
    hasSharedNormalizedTitle(left, right) &&
    (left.year === undefined || right.year === undefined || left.year === right.year)
  ) {
    return true;
  }

  return hasSameTitleYearIdentity(left, right);
}

function hasConflictingSearchIdentity(left: MediaItem, right: MediaItem): boolean {
  return (
    left.type === right.type &&
    hasStrongIdConflict(left.ids, right.ids) &&
    hasSameTitleYearIdentity(left, right)
  );
}

function hasSameTitleYearIdentity(left: MediaItem, right: MediaItem): boolean {
  if (left.year === undefined || left.year !== right.year) {
    return false;
  }

  return hasSharedNormalizedTitle(left, right);
}

function hasSharedNormalizedTitle(left: MediaItem, right: MediaItem): boolean {
  const leftTitles = new Set(titleCandidates(left).map(normalizeTitle).filter(Boolean));
  return titleCandidates(right).some((title) => leftTitles.has(normalizeTitle(title)));
}
