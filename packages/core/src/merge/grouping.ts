import type { MediaItem, MediaType } from "../media/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { hasSharedStrongId, hasStrongIdConflict } from "./identity.js";
import type { SearchEntry, SearchGroup } from "./internal.js";
import { STRONG_ID_KEYS } from "./internal.js";
import { exactTitleKey, normalizeTitle, titleCandidates } from "./title.js";

// Groups search results by exact IDs first, then by normalized title/year/type.
// Группирует результаты сначала по точным ID, затем по нормализованным title/year/type.
export function groupSearchResults(results: ProviderSearchResult[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const groupsByStrongId = new Map<string, number[]>();
  const groupsByTitleYearType = new Map<string, number[]>();

  results.forEach((result, index) => {
    const entry = { result, index };
    const exactIdGroupIndex = findIndexedGroup(
      strongIdIndexKeys(result.item),
      groupsByStrongId,
      groups,
      (group) => canJoinByExactId(entry, group),
    );

    if (exactIdGroupIndex !== undefined) {
      const exactIdGroup = groups[exactIdGroupIndex]!;
      exactIdGroup.entries.push(entry);
      exactIdGroup.matchStrength = "exact_id";
      indexSearchEntry(entry, exactIdGroupIndex, groupsByStrongId, groupsByTitleYearType);
      return;
    }

    const titleGroupIndex = findIndexedGroup(
      titleYearTypeIndexKeys(result.item),
      groupsByTitleYearType,
      groups,
      (group) => canJoinByTitleYearType(entry, group),
    );

    if (titleGroupIndex !== undefined) {
      const titleGroup = groups[titleGroupIndex]!;
      const isExactTitleMatch = hasExactTitleYearTypeMatch(entry, titleGroup);

      titleGroup.entries.push(entry);
      titleGroup.matchStrength =
        titleGroup.matchStrength === "exact_title_year_type" || isExactTitleMatch
          ? "exact_title_year_type"
          : "normalized_title_year_type";
      indexSearchEntry(entry, titleGroupIndex, groupsByStrongId, groupsByTitleYearType);
      return;
    }

    const groupIndex = groups.length;
    groups.push({ entries: [entry], matchStrength: "none" });
    indexSearchEntry(entry, groupIndex, groupsByStrongId, groupsByTitleYearType);
  });

  return groups;
}

function findIndexedGroup(
  keys: string[],
  index: Map<string, number[]>,
  groups: SearchGroup[],
  matches: (group: SearchGroup) => boolean,
): number | undefined {
  const candidates = new Set<number>();

  for (const key of keys) {
    for (const groupIndex of index.get(key) ?? []) {
      candidates.add(groupIndex);
    }
  }

  return [...candidates]
    .sort((left, right) => left - right)
    .find((groupIndex) => {
      const group = groups[groupIndex];
      return group ? matches(group) : false;
    });
}

function indexSearchEntry(
  entry: SearchEntry,
  groupIndex: number,
  groupsByStrongId: Map<string, number[]>,
  groupsByTitleYearType: Map<string, number[]>,
): void {
  addGroupIndex(groupsByStrongId, strongIdIndexKeys(entry.result.item), groupIndex);
  addGroupIndex(groupsByTitleYearType, titleYearTypeIndexKeys(entry.result.item), groupIndex);
}

function addGroupIndex(index: Map<string, number[]>, keys: string[], groupIndex: number): void {
  for (const key of keys) {
    const groupIndexes = index.get(key);

    if (!groupIndexes) {
      index.set(key, [groupIndex]);
    } else if (groupIndexes.at(-1) !== groupIndex && !groupIndexes.includes(groupIndex)) {
      groupIndexes.push(groupIndex);
    }
  }
}

function strongIdIndexKeys(item: MediaItem): string[] {
  return STRONG_ID_KEYS.flatMap((key) => {
    const value = item.ids?.[key];
    return value ? [`${item.type}:${key}:${value}`] : [];
  });
}

function titleYearTypeIndexKeys(item: MediaItem): string[] {
  if (item.year === undefined) {
    return [];
  }

  const typeKey = item.type === "anime" || item.type === "series" ? "series-or-anime" : item.type;

  return [...normalizedTitleCandidateSet(item)].map((title) => `${typeKey}:${item.year}:${title}`);
}

// Checks whether an entry can join a group through a shared strong external ID.
// Проверяет, может ли entry войти в группу по общему сильному внешнему ID.
function canJoinByExactId(entry: SearchEntry, group: SearchGroup): boolean {
  return group.entries.some((groupEntry) => {
    return (
      groupEntry.result.item.type === entry.result.item.type &&
      hasSharedStrongId(groupEntry.result.item.ids, entry.result.item.ids)
    );
  });
}

// Checks whether an entry can join a group by normalized title, year, and type.
// Проверяет, может ли entry войти в группу по нормализованным title, year и type.
function canJoinByTitleYearType(entry: SearchEntry, group: SearchGroup): boolean {
  const item = entry.result.item;

  return group.entries.some((groupEntry) => {
    const groupItem = groupEntry.result.item;

    return (
      areSearchTypesCompatible(item.type, groupItem.type) &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      hasSharedNormalizedTitleCandidate(item, groupItem) &&
      !hasStrongIdConflict(item.ids, groupItem.ids)
    );
  });
}

// Checks whether a title/year/type match is exact before normalization.
// Проверяет, является ли совпадение title/year/type точным до нормализации.
function hasExactTitleYearTypeMatch(entry: SearchEntry, group: SearchGroup): boolean {
  const item = entry.result.item;

  return group.entries.some((groupEntry) => {
    const groupItem = groupEntry.result.item;

    return (
      areSearchTypesCompatible(item.type, groupItem.type) &&
      item.year !== undefined &&
      item.year === groupItem.year &&
      hasSharedExactTitleCandidate(item, groupItem)
    );
  });
}

// Treats anime and series as compatible only for strong title/year grouping.
// Считает anime и series совместимыми только для сильной группировки по title/year.
function areSearchTypesCompatible(left: MediaType, right: MediaType): boolean {
  return (
    left === right ||
    (left === "anime" && right === "series") ||
    (left === "series" && right === "anime")
  );
}

// Checks title/original/alternative candidates after normalization.
// Проверяет title/original/alternative кандидаты после нормализации.
function hasSharedNormalizedTitleCandidate(left: MediaItem, right: MediaItem): boolean {
  const leftTitles = normalizedTitleCandidateSet(left);

  if (leftTitles.size === 0) {
    return false;
  }

  return titleCandidates(right).some((title) => leftTitles.has(normalizeTitle(title)));
}

// Checks title/original/alternative candidates without accent/case normalization.
// Проверяет title/original/alternative кандидаты без accent/case нормализации.
function hasSharedExactTitleCandidate(left: MediaItem, right: MediaItem): boolean {
  const leftTitles = new Set(titleCandidates(left).map(exactTitleKey).filter(Boolean));

  if (leftTitles.size === 0) {
    return false;
  }

  return titleCandidates(right).some((title) => leftTitles.has(exactTitleKey(title)));
}

// Builds normalized non-empty title candidate set for grouping.
// Собирает набор нормализованных непустых title candidates для группировки.
function normalizedTitleCandidateSet(item: MediaItem): Set<string> {
  return new Set(titleCandidates(item).map(normalizeTitle).filter(Boolean));
}
