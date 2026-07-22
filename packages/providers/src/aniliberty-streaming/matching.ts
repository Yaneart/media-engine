import type { MediaAvailability } from "@media-engine/core";
import { normalizeProviderSearchText } from "../shared/mapping.js";
import type { AniLibertyReleaseSummary } from "./client.js";

export function selectAniLibertyRelease(
  releases: AniLibertyReleaseSummary[],
  query: MediaAvailability["query"],
): AniLibertyReleaseSummary | undefined {
  const title = query.title?.trim();
  const year = query.year;

  if (!title || !Number.isInteger(year)) return undefined;

  const normalizedTitle = normalizeProviderSearchText(title);
  if (!normalizedTitle) return undefined;

  const matching = new Map<number, AniLibertyReleaseSummary>();

  for (const release of releases) {
    if (release.year !== year || !hasExactTitle(release, normalizedTitle)) continue;
    matching.set(release.id, release);
  }

  return matching.size === 1 ? matching.values().next().value : undefined;
}

export function matchesAniLibertyRelease(
  release: AniLibertyReleaseSummary,
  query: MediaAvailability["query"],
): boolean {
  const title = query.title?.trim();
  if (!title || release.year !== query.year) return false;

  const normalizedTitle = normalizeProviderSearchText(title);
  return Boolean(normalizedTitle) && hasExactTitle(release, normalizedTitle);
}

function hasExactTitle(release: AniLibertyReleaseSummary, normalizedQuery: string): boolean {
  return releaseTitles(release).some(
    (title) => normalizeProviderSearchText(title) === normalizedQuery,
  );
}

function releaseTitles(release: AniLibertyReleaseSummary): string[] {
  return [
    release.name.main,
    release.name.english,
    ...splitAlternativeTitles(release.name.alternative),
  ].filter((title): title is string => Boolean(title));
}

function splitAlternativeTitles(value: string | undefined): string[] {
  return value
    ? value
        .split(/[,;|]/u)
        .map((title) => title.trim())
        .filter(Boolean)
        .slice(0, 16)
    : [];
}
