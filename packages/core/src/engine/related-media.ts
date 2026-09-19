import type { ExternalIds, ProviderSource } from "../media/index.js";
import type { ProviderRelatedMediaResult } from "../providers/index.js";
import type { MediaRelation, RelatedMediaItem, RelatedMediaQuery } from "../related/index.js";

const DEFAULT_RELATED_MEDIA_LIMIT = 100;
const MAX_PROVIDER_RELATIONS = 100;

// Merges only relations with the same kind and an explicit shared external ID.
// Объединяет только связи одного типа с явно совпавшим внешним ID.
export function mergeRelatedMediaResults(
  results: ProviderRelatedMediaResult[],
  query: RelatedMediaQuery,
): MediaRelation[] {
  const merged: MediaRelation[] = [];
  const limit = query.limit ?? DEFAULT_RELATED_MEDIA_LIMIT;

  if (limit === 0) return merged;

  for (const result of results) {
    for (const relation of result.relations.slice(0, MAX_PROVIDER_RELATIONS)) {
      const source = relation.source ?? {
        provider: result.provider,
        ids: relation.item.ids,
      };
      const existing = merged.find(
        (candidate) =>
          candidate.kind === relation.kind &&
          sharesExternalId(candidate.item.ids, relation.item.ids),
      );

      if (existing) {
        existing.item = mergeRelatedItem(existing.item, relation.item);
        appendSource(existing.sources, source);
        continue;
      }

      merged.push({
        kind: relation.kind,
        item: structuredClone(relation.item),
        sources: [structuredClone(source)],
      });
    }
  }

  return merged.slice(0, limit);
}

function sharesExternalId(left: ExternalIds | undefined, right: ExternalIds | undefined): boolean {
  if (!left || !right) return false;

  return Object.entries(left).some(
    ([source, value]) => value !== undefined && right[source as keyof ExternalIds] === value,
  );
}

function mergeRelatedItem(left: RelatedMediaItem, right: RelatedMediaItem): RelatedMediaItem {
  return {
    ...right,
    ...left,
    ids: { ...right.ids, ...left.ids },
    alternativeTitles: mergeStrings(left.alternativeTitles, right.alternativeTitles),
    genres: left.genres ?? right.genres,
    ratings: left.ratings ?? right.ratings,
  };
}

function mergeStrings(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const values = [...new Set([...(left ?? []), ...(right ?? [])])];
  return values.length > 0 ? values : undefined;
}

function appendSource(target: ProviderSource[], source: ProviderSource): void {
  if (
    target.some(
      (candidate) =>
        candidate.provider === source.provider &&
        candidate.url === source.url &&
        JSON.stringify(candidate.ids) === JSON.stringify(source.ids),
    )
  ) {
    return;
  }

  target.push(structuredClone(source));
}
