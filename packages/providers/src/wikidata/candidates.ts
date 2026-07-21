import type { MediaType, ProviderSearchQuery } from "@media-engine/core";
import { normalizeProviderSearchText as normalizeSearchText } from "../shared/mapping.js";

export interface WikidataSearchEntry {
  id?: string;
  label?: string;
  description?: string;
  match?: {
    text?: string;
  };
}

// Keeps only title-relevant search summaries and drops obvious non-media hits before the
// selected-property entity request. Unknown summaries remain eligible to avoid locale-specific
// false negatives.
// Оставляет релевантные title summaries и отсекает явный не-media шум до entity-запроса.
export function selectWikidataEntityIds(
  entries: WikidataSearchEntry[],
  query: ProviderSearchQuery,
  entityLimit: number,
): string[] {
  const title = query.title?.trim();
  const classified = entries
    .filter((entry) => {
      if (!normalizeWikidataEntityId(entry.id)) {
        return false;
      }

      return title
        ? [entry.match?.text, entry.label].some(
            (candidate) => candidate && isRelevantWikidataTitleMatch(candidate, title),
          )
        : true;
    })
    .map((entry) => ({ entry, relevance: classifySummary(entry.description, query.type) }))
    .filter(({ relevance }) => relevance !== "irrelevant");

  return [
    ...classified.filter(({ relevance }) => relevance === "preferred"),
    ...classified.filter(({ relevance }) => relevance === "unknown"),
  ]
    .slice(0, entityLimit)
    .map(({ entry }) => normalizeWikidataEntityId(entry.id))
    .filter((id): id is string => id !== undefined);
}

const CHILD_OR_COLLECTION_SUMMARY_PATTERN =
  /\b(?:episode|season|film series|media franchise)\b|эпизод|сезон|медиафраншиз|кинофраншиз/iu;
const NON_MEDIA_SUMMARY_PATTERN =
  /\b(?:video|computer|board) game\b|\b(?:studio |live |soundtrack )?album\b|\b(?:song|single|novel|book|surname|family name|given name|city|town|village|municipality|landform|fictional character|company|organization|university|school|asteroid|taxon|band|mud|virtual world)\b|видеоигр|компьютерн\S* игр|настольн\S* игр|альбом|песн|роман|книг|фамили|город|насел[её]нн|франшиз|персонаж|саундтрек|компани|организац|университет|школ/iu;
const MOVIE_SUMMARY_PATTERN =
  /\b(?:film|movie|motion picture|telefilm)\b|фильм|кинофильм|мультфильм/iu;
const SERIES_SUMMARY_PATTERN =
  /\b(?:television|tv|web|anime) series\b|\bminiseries\b|телесериал|мини-сериал|аниме-сериал/iu;

type SummaryRelevance = "preferred" | "unknown" | "irrelevant";

function classifySummary(
  description: string | undefined,
  type: MediaType | undefined,
): SummaryRelevance {
  if (!description) {
    return "unknown";
  }

  if (CHILD_OR_COLLECTION_SUMMARY_PATTERN.test(description)) {
    return "irrelevant";
  }

  const describesMovie = MOVIE_SUMMARY_PATTERN.test(description);
  const describesSeries = SERIES_SUMMARY_PATTERN.test(description);

  if (type === "movie" && describesMovie) {
    return "preferred";
  }

  if (type === "series" && describesSeries) {
    return "preferred";
  }

  if (!type && (describesMovie || describesSeries)) {
    return "preferred";
  }

  if (type === "movie" && describesSeries) {
    return "irrelevant";
  }

  return (type === "series" && describesMovie) || NON_MEDIA_SUMMARY_PATTERN.test(description)
    ? "irrelevant"
    : "unknown";
}

export function isRelevantWikidataTitleMatch(title: string, queryTitle: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(queryTitle);

  return normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle);
}

// Accepts only canonical Wikidata item IDs before using upstream values in queries/cache keys.
// Принимает только canonical Wikidata item IDs до использования upstream values в запросах.
export function normalizeWikidataEntityId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();

  return normalized && /^Q[1-9]\d*$/.test(normalized) ? normalized : undefined;
}
