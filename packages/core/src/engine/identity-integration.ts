import type { IdentityResolver } from "../identity/index.js";
import type { ExternalIds, MediaItem, MediaType } from "../media/index.js";
import { hasSharedStrongId, hasStrongIdConflict } from "../merge/identity.js";
import type { MergeStrategy } from "../merge/index.js";
import type { EngineWarning } from "../response/index.js";
import type { MediaSearchResult } from "../search/index.js";

const MAX_SEARCH_RESOLUTIONS = 5;
const MEDIA_TYPES: readonly MediaType[] = ["movie", "series", "anime"];

export function hasIdentitySourceFailure(warnings: readonly EngineWarning[]): boolean {
  return warnings.some(({ code }) => code === "SOURCE_TIMEOUT" || code === "SOURCE_ERROR");
}

function reportDiagnostics(
  diagnostics: readonly { code: string; source?: string }[],
  warnings?: EngineWarning[],
): void {
  if (!warnings) return;
  for (const { code, source } of diagnostics) {
    if (!["SOURCE_TIMEOUT", "SOURCE_ERROR", "AMBIGUOUS_ID", "EXTERNAL_ID_CONFLICT"].includes(code))
      continue;
    if (warnings.some((warning) => warning.code === code && warning.provider === source)) continue;
    warnings.push({
      code,
      provider: source,
      message: `Identity resolution: ${code.toLowerCase().replaceAll("_", " ")}.`,
    });
  }
}

export async function resolveQueryIdentity<T extends { type?: MediaType; ids?: ExternalIds }>(
  query: T,
  resolver: IdentityResolver | undefined,
  signal?: AbortSignal,
  warnings?: EngineWarning[],
): Promise<T> {
  if (!resolver || !Object.values(query.ids ?? {}).some(Boolean)) return query;
  if (query.type) {
    const result = await resolver.resolve(query.type, { ...query.ids }, signal);
    reportDiagnostics(result.diagnostics, warnings);
    return { ...query, ids: { ...query.ids, ...result.ids } };
  }

  const candidateTypes = hasAnimeIdentity(query.ids) ? (["anime"] as const) : MEDIA_TYPES;
  const candidates = await Promise.all(
    candidateTypes.map((type) => resolver.resolve(type, { ...query.ids }, signal)),
  );
  for (const candidate of candidates) reportDiagnostics(candidate.diagnostics, warnings);
  const confirmed = candidates.filter((candidate) =>
    candidate.provenance.some(({ source }) => source !== "initial"),
  );
  if (confirmed.length !== 1) return query;
  const [identity] = confirmed;
  return { ...query, type: identity!.type, ids: { ...query.ids, ...identity!.ids } };
}

function hasAnimeIdentity(ids: ExternalIds | undefined): boolean {
  return Boolean(ids?.aniList || ids?.myAnimeList || ids?.shikimori);
}

export async function resolveItemIdentity<T extends MediaItem>(
  item: T,
  resolver: IdentityResolver | undefined,
  signal?: AbortSignal,
  warnings?: EngineWarning[],
): Promise<T> {
  if (!resolver || !Object.values(item.ids ?? {}).some(Boolean)) return item;
  const result = await resolver.resolve(item.type, { ...item.ids }, signal);
  reportDiagnostics(result.diagnostics, warnings);
  return { ...item, ids: { ...item.ids, ...result.ids } };
}

export async function resolveSearchIdentities(
  results: MediaSearchResult[],
  resolver: IdentityResolver | undefined,
  signal: AbortSignal | undefined,
  warnings: EngineWarning[],
  mergeStrategy: MergeStrategy,
  language?: string,
): Promise<MediaSearchResult[]> {
  if (!resolver) return results;
  const enriched = await Promise.all(
    results.map(async (result, index) =>
      index < MAX_SEARCH_RESOLUTIONS
        ? { ...result, item: await resolveItemIdentity(result.item, resolver, signal, warnings) }
        : result,
    ),
  );
  const merged: MediaSearchResult[] = [];
  for (const result of enriched) {
    const existing = merged.find(
      (candidate) =>
        candidate.item.type === result.item.type &&
        hasSharedStrongId(candidate.item.ids, result.item.ids) &&
        !hasStrongIdConflict(candidate.item.ids, result.item.ids),
    );
    if (!existing) {
      merged.push(result);
      continue;
    }
    const combined = mergeStrategy.mergeSearchResults(
      [existing, result].map((entry) => ({
        provider: entry.sources[0]?.provider ?? "identity",
        item: entry.item,
      })),
      { language },
    );
    if (combined.length !== 1) {
      merged.push(result);
      continue;
    }
    existing.item = { ...combined[0]!.item, id: existing.item.id };
    existing.sources = [
      ...existing.sources,
      ...result.sources.filter(
        (source) =>
          !existing.sources.some(
            (known) =>
              known.provider === source.provider &&
              known.url === source.url &&
              JSON.stringify(known.ids ?? {}) === JSON.stringify(source.ids ?? {}),
          ),
      ),
    ];
  }
  return merged;
}
