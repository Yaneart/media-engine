import type { TorrentDiscoveryQuery } from "@media-engine/core";
import { normalizeProviderSearchText } from "../shared/mapping.js";
import type { BitsearchTorrentRelease } from "./client.js";

const LEADING_GROUPS = /^(?:\s*[[(][^\])]{1,80}[\])]\s*)+/u;
const SEASON_TOKEN =
  /(?:^|[\s._([{])(?:s(?:eason)?[ ._-]*\d{1,3}|\d{1,3}[ ._-]*x[ ._-]*\d{1,4})(?=$|[\s._)\]}-])/iu;
const ABSOLUTE_EPISODE_TOKEN =
  /(?:^|[\s._([{])(?:ep(?:isode)?[ ._-]*\d{1,4}|e[ ._-]*\d{1,4}|-[ ]*\d{1,4})(?=$|[\s._)\]}-])/iu;

interface EpisodeScope {
  seasonStart?: number;
  seasonEnd?: number;
  episodeStart?: number;
  episodeEnd?: number;
  absoluteStart?: number;
  absoluteEnd?: number;
}

export function selectBitsearchTorrentReleases(
  releases: BitsearchTorrentRelease[],
  query: TorrentDiscoveryQuery,
): BitsearchTorrentRelease[] {
  return releases.filter(
    (release) =>
      release.category === mapQueryCategory(query.type) &&
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

function mapQueryCategory(type: TorrentDiscoveryQuery["type"]): number {
  if (type === "movie") return 2;
  if (type === "series") return 3;
  return 4;
}
