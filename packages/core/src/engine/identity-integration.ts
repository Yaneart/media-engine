import type { IdentityResolver } from "../identity/index.js";
import type { ExternalIds, MediaItem, MediaType } from "../media/index.js";
import { hasSharedStrongId, hasStrongIdConflict } from "../merge/identity.js";
import type { ProviderSearchResult } from "../providers/index.js";
import type { EngineWarning } from "../response/index.js";
import type { MediaSearchResult } from "../search/index.js";
import { SEARCH_CANONICALIZATION_WINDOW } from "./query.js";

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

export async function canonicalizeSearchCandidateWindow(
  providerResults: ProviderSearchResult[],
  candidates: MediaSearchResult[],
  resolver: IdentityResolver | undefined,
  signal: AbortSignal | undefined,
  warnings: EngineWarning[],
): Promise<ProviderSearchResult[]> {
  if (!resolver) return providerResults;
  const resolvedCandidates = await Promise.all(
    candidates.slice(0, SEARCH_CANONICALIZATION_WINDOW).map(async (candidate) => ({
      candidate,
      resolved: await resolveItemIdentity(candidate.item, resolver, signal, warnings),
    })),
  );
  let changed = false;

  const canonical = providerResults.map((result) => {
    const match = resolvedCandidates.find(({ candidate }) =>
      candidate.sources.some(
        (source) =>
          source.provider === (result.source?.provider ?? result.provider) &&
          (hasSharedStrongId(source.ids, result.item.ids) ||
            (candidate.item.id === result.item.id &&
              candidate.item.type === result.item.type &&
              candidate.sources[0]?.provider === result.provider)),
      ),
    );

    if (!match || hasStrongIdConflict(result.item.ids, match.resolved.ids)) {
      return result;
    }

    const identityChanged = Object.entries(match.resolved.ids ?? {}).some(
      ([namespace, value]) => result.item.ids?.[namespace as keyof ExternalIds] !== value,
    );

    if (!identityChanged) {
      return result;
    }

    changed = true;

    return {
      ...result,
      item: {
        ...result.item,
        ids: { ...result.item.ids, ...match.resolved.ids },
      },
    };
  });

  return changed ? canonical : providerResults;
}
