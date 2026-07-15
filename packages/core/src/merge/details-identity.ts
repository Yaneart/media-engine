import type { ExternalIds, MediaType } from "../media/index.js";
import { hasSharedStrongId, strongIdConflicts } from "./identity.js";
import type { DetailsEntry } from "./internal.js";
import { STRONG_ID_KEYS } from "./internal.js";
import type { MergeContext } from "./types.js";

// Keeps details attached to one strong-ID identity before any fields are combined.
// Оставляет details одной strong-ID сущности до объединения любых полей.
export function filterDetailsEntriesByIdentity(
  entries: DetailsEntry[],
  context: MergeContext,
): DetailsEntry[] {
  const selectedIds: ExternalIds = { ...readQueryExternalIds(context) };
  const accepted: DetailsEntry[] = [];

  for (const entry of entries) {
    const ids = entry.result.details.ids;
    const conflicts = strongIdConflicts(selectedIds, ids);

    if (conflicts.length > 0 && !hasSharedStrongId(selectedIds, ids)) {
      for (const key of conflicts) {
        context.warnings?.push({
          code: "EXTERNAL_ID_CONFLICT",
          message: `Conflicting ${key} IDs while merging details; excluded ${ids?.[key]}.`,
          provider: entry.result.provider,
        });
      }
      continue;
    }

    accepted.push(entry);

    for (const key of STRONG_ID_KEYS) {
      if (!selectedIds[key] && ids?.[key]) {
        selectedIds[key] = ids[key];
      }
    }
  }

  return accepted;
}

// Emits warnings when details results contain conflicting media types.
// Добавляет warnings, когда details-результаты содержат конфликтующие типы медиа.
export function warnDetailsTypeConflicts(
  entries: DetailsEntry[],
  context: MergeContext,
  selectedType?: MediaType,
): void {
  const primaryType = selectedType ?? entries[0]?.result.details.type;

  if (!primaryType) {
    return;
  }

  for (const entry of entries) {
    const entryType = entry.result.details.type;
    const isCompatibleAnimeCatalogType = primaryType === "anime" && entryType === "series";

    if (entryType !== primaryType && !isCompatibleAnimeCatalogType) {
      context.warnings?.push({
        code: "MEDIA_TYPE_CONFLICT",
        message: `Conflicting media types while merging details; kept ${primaryType}.`,
        provider: entry.result.provider,
      });
    }
  }
}

function readQueryExternalIds(context: MergeContext): ExternalIds | undefined {
  const query = context.query;

  if (!query) {
    return undefined;
  }

  const ids: ExternalIds = { ...query.ids };

  for (const key of STRONG_ID_KEYS) {
    const value = query[key];

    if (typeof value === "string" && value.trim()) {
      ids[key] = value.trim();
    }
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
}
