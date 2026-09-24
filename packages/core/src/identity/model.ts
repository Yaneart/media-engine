import type { ExternalIds, MediaType } from "../media/index.js";

export const IDENTITY_NAMESPACES = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "tvdb",
  "wikidata",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
] as const;

export type IdentityNamespace = (typeof IDENTITY_NAMESPACES)[number];
export type IdentityIds = ExternalIds & { tvdb?: string; wikidata?: string };
export type IdentityDiagnosticCode =
  | "INVALID_ID"
  | "UNSUPPORTED_NAMESPACE"
  | "UNPROVEN_LINK"
  | "TYPE_CONFLICT"
  | "EXTERNAL_ID_CONFLICT"
  | "AMBIGUOUS_ID";

export interface IdentityDiagnostic {
  code: IdentityDiagnosticCode;
  namespace?: string;
  source?: string;
}

export interface IdentityProvenance {
  namespace: IdentityNamespace;
  value: string;
  source: string;
  matched?: { namespace: IdentityNamespace; value: string };
}

export interface IdentityClaim {
  source: string;
  type: MediaType;
  // The source must return this ID in the same source record as the proposed IDs.
  matched: { namespace: IdentityNamespace; value: string };
  ids: Record<string, unknown>;
}

export interface IdentityResolution {
  type: MediaType;
  ids: IdentityIds;
  provenance: IdentityProvenance[];
  diagnostics: IdentityDiagnostic[];
}

const namespaces = new Set<string>(IDENTITY_NAMESPACES);
const numeric = new Set<IdentityNamespace>([
  "tmdb",
  "kinopoisk",
  "tvdb",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
]);

export function normalizeIdentityId(
  namespace: IdentityNamespace,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return undefined;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 128) return undefined;
  if (namespace === "imdb")
    return /^tt\d{7,12}$/iu.test(normalized) ? normalized.toLowerCase() : undefined;
  if (namespace === "wikidata")
    return /^Q[1-9]\d*$/iu.test(normalized) ? normalized.toUpperCase() : undefined;
  if (numeric.has(namespace)) {
    if (!/^0*[1-9]\d*$/u.test(normalized)) return undefined;
    return BigInt(normalized).toString();
  }
  return undefined;
}

function normalizeIds(
  input: Record<string, unknown>,
  diagnostics: IdentityDiagnostic[],
  source: string,
): IdentityIds {
  const ids: IdentityIds = {};
  for (const [namespace, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    if (!namespaces.has(namespace)) {
      diagnostics.push({ code: "UNSUPPORTED_NAMESPACE", namespace, source });
      continue;
    }
    const key = namespace as IdentityNamespace;
    const value = normalizeIdentityId(key, raw);
    if (value === undefined) diagnostics.push({ code: "INVALID_ID", namespace, source });
    else ids[key] = value;
  }
  return ids;
}

// Initial IDs are authoritative for this resolution. Source claims may only extend them.
export function resolveIdentityClaims(
  type: MediaType,
  initial: Record<string, unknown>,
  claims: readonly IdentityClaim[],
): IdentityResolution {
  const diagnostics: IdentityDiagnostic[] = [];
  const ids = normalizeIds(initial, diagnostics, "initial");
  const provenance: IdentityProvenance[] = IDENTITY_NAMESPACES.flatMap((namespace) =>
    ids[namespace] ? [{ namespace, value: ids[namespace], source: "initial" }] : [],
  );
  const candidates = new Map<IdentityNamespace, Map<string, IdentityProvenance[]>>();

  for (const claim of claims) {
    if (claim.type !== type) {
      diagnostics.push({ code: "TYPE_CONFLICT", source: claim.source });
      continue;
    }
    const anchor = normalizeIdentityId(claim.matched.namespace, claim.matched.value);
    if (!anchor || ids[claim.matched.namespace] !== anchor) {
      diagnostics.push({ code: "UNPROVEN_LINK", source: claim.source });
      continue;
    }
    const candidateIds = normalizeIds(claim.ids, diagnostics, claim.source);
    if (candidateIds[claim.matched.namespace] !== anchor) {
      diagnostics.push({ code: "UNPROVEN_LINK", source: claim.source });
      continue;
    }
    const conflicts = IDENTITY_NAMESPACES.filter(
      (namespace) =>
        ids[namespace] && candidateIds[namespace] && ids[namespace] !== candidateIds[namespace],
    );
    if (conflicts.length) {
      for (const namespace of conflicts)
        diagnostics.push({ code: "EXTERNAL_ID_CONFLICT", namespace, source: claim.source });
      continue;
    }
    for (const namespace of IDENTITY_NAMESPACES) {
      const value = candidateIds[namespace];
      if (!value) continue;
      const evidence: IdentityProvenance = {
        namespace,
        value,
        source: claim.source,
        matched: { namespace: claim.matched.namespace, value: anchor },
      };
      if (ids[namespace] === value) {
        provenance.push(evidence);
        continue;
      }
      const values = candidates.get(namespace) ?? new Map<string, IdentityProvenance[]>();
      values.set(value, [...(values.get(value) ?? []), evidence]);
      candidates.set(namespace, values);
    }
  }

  for (const [namespace, values] of candidates) {
    if (values.size !== 1) {
      diagnostics.push({ code: "AMBIGUOUS_ID", namespace });
      continue;
    }
    const [value, evidence] = values.entries().next().value!;
    ids[namespace] = value;
    provenance.push(...evidence);
  }
  return { type, ids, provenance, diagnostics };
}
