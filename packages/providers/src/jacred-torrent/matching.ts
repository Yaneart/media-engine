import type { TorrentDiscoveryQuery } from "@media-engine/core";
import { normalizeProviderSearchText } from "../shared/mapping.js";
import type { JacRedTorrentRelease } from "./client.js";

export function selectJacRedTorrentReleases(
  releases: JacRedTorrentRelease[],
  query: TorrentDiscoveryQuery,
): JacRedTorrentRelease[] {
  const titles = new Set(
    [query.title, ...(query.alternativeTitles ?? [])]
      .filter((title): title is string => Boolean(title))
      .map(normalizeProviderSearchText),
  );

  return releases.filter(
    (release) =>
      release.year === query.year &&
      [release.name, release.originalName].some(
        (candidate) => candidate && titles.has(normalizeProviderSearchText(candidate)),
      ) &&
      matchesMediaType(release.categories, query.type) &&
      (query.seasonNumber === undefined || release.seasons.includes(query.seasonNumber)),
  );
}

function matchesMediaType(categories: string[], type: TorrentDiscoveryQuery["type"]): boolean {
  const normalized = new Set(categories.map((category) => category.toLowerCase()));

  if (type === "movie") return normalized.has("movie") || normalized.has("multfilm");
  if (type === "series") return normalized.has("serial") || normalized.has("multserial");
  return normalized.has("anime") || normalized.has("multfilm") || normalized.has("multserial");
}
