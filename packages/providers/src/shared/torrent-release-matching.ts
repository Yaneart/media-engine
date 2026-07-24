import type { TorrentDiscoveryQuery } from "@media-engine/core";
import { normalizeProviderSearchText } from "./mapping.js";

const LEADING_GROUPS = /^(?:\s*[[(][^\])]{1,80}[\])]\s*)+/u;
const SEASON_TOKEN =
  /(?:^|[\s._([{])(?:s(?:eason)?[ ._-]*\d{1,3}|\d{1,3}[ ._-]*x[ ._-]*\d{1,4})(?=$|[\s._)\]}-])/iu;
const ABSOLUTE_EPISODE_TOKEN =
  /(?:^|[\s._([{])(?:ep(?:isode)?[ ._-]*\d{1,4}|e[ ._-]*\d{1,4}|-[ ]*\d{1,4})(?=$|[\s._)\]}-])/iu;

export interface NamedTorrentRelease {
  title: string;
}

interface EpisodeScope {
  seasonStart?: number;
  seasonEnd?: number;
  episodeStart?: number;
  episodeEnd?: number;
  absoluteStart?: number;
  absoluteEnd?: number;
}

export function canResolveStrictTorrentQuery(query: TorrentDiscoveryQuery): boolean {
  const title = query.title?.trim();
  const numericFields = [query.seasonNumber, query.episodeNumber, query.absoluteEpisodeNumber];

  if (
    !title ||
    title.length < 2 ||
    !Number.isInteger(query.year) ||
    query.year! < 1_800 ||
    query.year! > 3_000 ||
    numericFields.some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 9_999),
    )
  ) {
    return false;
  }

  if (query.type === "movie") {
    return numericFields.every((value) => value === undefined);
  }

  if (query.absoluteEpisodeNumber !== undefined) {
    return query.seasonNumber === undefined && query.episodeNumber === undefined;
  }

  return query.episodeNumber === undefined || query.seasonNumber !== undefined;
}

export function createTorrentReleaseSearchTerm(query: TorrentDiscoveryQuery): string {
  const parts = [query.title!.trim(), String(query.year)];

  if (query.absoluteEpisodeNumber !== undefined) {
    parts.push(`E${formatEpisodeNumber(query.absoluteEpisodeNumber)}`);
  } else if (query.seasonNumber !== undefined && query.episodeNumber !== undefined) {
    parts.push(
      `S${formatEpisodeNumber(query.seasonNumber)}E${formatEpisodeNumber(query.episodeNumber)}`,
    );
  } else if (query.seasonNumber !== undefined) {
    parts.push(`S${formatEpisodeNumber(query.seasonNumber)}`);
  }

  return parts.join(" ");
}

export function selectStrictTorrentReleases<T extends NamedTorrentRelease>(
  releases: T[],
  query: TorrentDiscoveryQuery,
): T[] {
  return releases.filter(
    (release) =>
      hasExactYear(release.title, query.year!) &&
      hasExactTitle(release.title, query.title!, query) &&
      matchesEpisodeQuery(release.title, query),
  );
}

function hasExactYear(title: string, year: number): boolean {
  return new RegExp(`(?<!\\d)${year}(?!\\d)`, "u").test(title);
}

function hasExactTitle(
  releaseTitle: string,
  queryTitle: string,
  query: TorrentDiscoveryQuery,
): boolean {
  const title = releaseTitle.replace(LEADING_GROUPS, "");
  const markerIndexes = [findYearIndex(title, query.year!)];

  if (query.type !== "movie") {
    markerIndexes.push(findMatchIndex(title, SEASON_TOKEN));
    markerIndexes.push(findMatchIndex(title, ABSOLUTE_EPISODE_TOKEN));
  }

  const markerIndex = markerIndexes
    .filter((index): index is number => index !== undefined)
    .reduce<number | undefined>((earliest, index) => {
      return earliest === undefined || index < earliest ? index : earliest;
    }, undefined);

  if (markerIndex === undefined) return false;

  const expected = normalizeProviderSearchText(queryTitle);
  const candidates = title
    .slice(0, markerIndex)
    .split(/\s+(?:\/|\||aka)\s+/iu)
    .map((candidate) => normalizeProviderSearchText(candidate))
    .filter(Boolean);

  return candidates.includes(expected);
}

function matchesEpisodeQuery(title: string, query: TorrentDiscoveryQuery): boolean {
  if (
    query.seasonNumber === undefined &&
    query.episodeNumber === undefined &&
    query.absoluteEpisodeNumber === undefined
  ) {
    return true;
  }

  const scope = parseEpisodeScope(title);

  if (query.absoluteEpisodeNumber !== undefined) {
    return includesNumber(query.absoluteEpisodeNumber, scope.absoluteStart, scope.absoluteEnd);
  }

  if (
    query.seasonNumber === undefined ||
    !includesNumber(query.seasonNumber, scope.seasonStart, scope.seasonEnd)
  ) {
    return false;
  }

  return query.episodeNumber === undefined
    ? true
    : includesNumber(query.episodeNumber, scope.episodeStart, scope.episodeEnd);
}

function parseEpisodeScope(title: string): EpisodeScope {
  const compact = title.replace(/[._]/gu, " ");
  const seasonEpisode =
    /\bs\s*(\d{1,3})(?:\s*-\s*s?\s*(\d{1,3}))?(?:\s*e\s*(\d{1,4})(?:\s*-\s*e?\s*(\d{1,4}))?)?\b/iu.exec(
      compact,
    );

  if (seasonEpisode?.[1]) {
    return {
      seasonStart: Number(seasonEpisode[1]),
      seasonEnd: Number(seasonEpisode[2] ?? seasonEpisode[1]),
      ...(seasonEpisode[3]
        ? {
            episodeStart: Number(seasonEpisode[3]),
            episodeEnd: Number(seasonEpisode[4] ?? seasonEpisode[3]),
          }
        : {}),
    };
  }

  const namedSeason =
    /\bseason\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?(?:\s*episode\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?)?\b/iu.exec(
      compact,
    );

  if (namedSeason?.[1]) {
    return {
      seasonStart: Number(namedSeason[1]),
      seasonEnd: Number(namedSeason[2] ?? namedSeason[1]),
      ...(namedSeason[3]
        ? {
            episodeStart: Number(namedSeason[3]),
            episodeEnd: Number(namedSeason[4] ?? namedSeason[3]),
          }
        : {}),
    };
  }

  const xEpisode = /\b(\d{1,3})\s*x\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?\b/iu.exec(compact);

  if (xEpisode?.[1] && xEpisode[2]) {
    return {
      seasonStart: Number(xEpisode[1]),
      seasonEnd: Number(xEpisode[1]),
      episodeStart: Number(xEpisode[2]),
      episodeEnd: Number(xEpisode[3] ?? xEpisode[2]),
    };
  }

  const absoluteEpisode =
    /\b(?:ep(?:isode)?|e)\s*(\d{1,4})(?:\s*-\s*(?:ep(?:isode)?|e)?\s*(\d{1,4}))?\b/iu.exec(
      compact,
    ) ?? /(?:^|\s)-\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?=$|\s|\[)/u.exec(compact);

  return absoluteEpisode?.[1]
    ? {
        absoluteStart: Number(absoluteEpisode[1]),
        absoluteEnd: Number(absoluteEpisode[2] ?? absoluteEpisode[1]),
      }
    : {};
}

function formatEpisodeNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function includesNumber(
  value: number,
  start: number | undefined,
  end: number | undefined,
): boolean {
  return start !== undefined && value >= start && value <= (end ?? start);
}

function findYearIndex(title: string, year: number): number | undefined {
  return findMatchIndex(title, new RegExp(`(?<!\\d)${year}(?!\\d)`, "u"));
}

function findMatchIndex(title: string, pattern: RegExp): number | undefined {
  const index = pattern.exec(title)?.index;
  return index === undefined ? undefined : index;
}
