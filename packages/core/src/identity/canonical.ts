import { randomUUID } from "node:crypto";

import type { MediaType } from "../media/index.js";
import {
  IDENTITY_NAMESPACES,
  normalizeIdentityId,
  type IdentityIds,
  type IdentityNamespace,
} from "./model.js";

declare const workKeyBrand: unique symbol;

// Opaque, registry-owned identity. It must never be derived from a provider ID or a title slug.
export type WorkKey = string & { readonly [workKeyBrand]: true };

export interface IdentityAlias {
  namespace: IdentityNamespace;
  value: string;
}

export interface CanonicalWorkIdentity {
  workKey: WorkKey;
  type: MediaType;
  ids: IdentityIds;
  aliases: string[];
}

export interface CanonicalIdentityConflict {
  code: "CANONICAL_IDENTITY_CONFLICT";
  aliases: string[];
  workKeys: WorkKey[];
}

export type CanonicalIdentityResult =
  | { status: "created" | "resolved"; identity: CanonicalWorkIdentity }
  | { status: "conflict"; conflict: CanonicalIdentityConflict };

export type WorkKeyFactory = () => WorkKey;

const namespaces = new Set<string>(IDENTITY_NAMESPACES);

export function createWorkKey(): WorkKey {
  return `work_${randomUUID()}` as WorkKey;
}

export function formatIdentityAlias(alias: IdentityAlias): string {
  const value = normalizeIdentityId(alias.namespace, alias.value);
  if (!value) throw new TypeError(`Invalid ${alias.namespace} identity alias`);
  return `${alias.namespace}:${value}`;
}

export function parseIdentityAlias(value: string): IdentityAlias | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) return undefined;
  const namespace = value.slice(0, separator);
  if (!namespaces.has(namespace)) return undefined;
  const normalized = normalizeIdentityId(
    namespace as IdentityNamespace,
    value.slice(separator + 1),
  );
  return normalized ? { namespace: namespace as IdentityNamespace, value: normalized } : undefined;
}

function normalizeAliases(input: Readonly<Record<string, unknown>>): {
  ids: IdentityIds;
  aliases: string[];
} {
  const ids: IdentityIds = {};
  const aliases: string[] = [];
  for (const namespace of IDENTITY_NAMESPACES) {
    const value = normalizeIdentityId(namespace, input[namespace]);
    if (!value) continue;
    ids[namespace] = value;
    aliases.push(formatIdentityAlias({ namespace, value }));
  }
  return { ids, aliases };
}

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort() as T[];
}

// Process-local implementation of the canonical identity contract. Applications that need
// durable identities can persist the same workKey/type/alias model behind their own registry.
export class CanonicalIdentityIndex {
  private readonly identities = new Map<WorkKey, CanonicalWorkIdentity>();
  private readonly aliasToWorkKey = new Map<string, WorkKey>();

  constructor(private readonly workKeyFactory: WorkKeyFactory = createWorkKey) {}

  resolve(alias: string): CanonicalWorkIdentity | undefined {
    const parsed = parseIdentityAlias(alias);
    if (!parsed) return undefined;
    const workKey = this.aliasToWorkKey.get(formatIdentityAlias(parsed));
    return workKey ? this.copy(this.identities.get(workKey)) : undefined;
  }

  resolveOrCreate(
    type: MediaType,
    input: Readonly<Record<string, unknown>>,
  ): CanonicalIdentityResult {
    const normalized = normalizeAliases(input);
    if (!normalized.aliases.length) throw new TypeError("Canonical identity needs an external ID");

    const matchedKeys = sortedUnique(
      normalized.aliases.flatMap((alias) => {
        const workKey = this.aliasToWorkKey.get(alias);
        return workKey ? [workKey] : [];
      }),
    );
    if (matchedKeys.length > 1) return this.conflict(normalized.aliases, matchedKeys);

    const existing = matchedKeys[0] ? this.identities.get(matchedKeys[0]) : undefined;
    if (existing) {
      const conflictingAliases = IDENTITY_NAMESPACES.flatMap((namespace) => {
        const current = existing.ids[namespace];
        const incoming = normalized.ids[namespace];
        return current && incoming && current !== incoming
          ? [
              formatIdentityAlias({ namespace, value: current }),
              formatIdentityAlias({ namespace, value: incoming }),
            ]
          : [];
      });
      if (existing.type !== type || conflictingAliases.length) {
        return this.conflict([...normalized.aliases, ...conflictingAliases], [existing.workKey]);
      }
      const identity: CanonicalWorkIdentity = {
        workKey: existing.workKey,
        type,
        ids: { ...existing.ids, ...normalized.ids },
        aliases: sortedUnique([...existing.aliases, ...normalized.aliases]),
      };
      this.store(identity);
      return { status: "resolved", identity: this.copy(identity)! };
    }

    const identity: CanonicalWorkIdentity = {
      workKey: this.workKeyFactory(),
      type,
      ids: normalized.ids,
      aliases: normalized.aliases,
    };
    if (this.identities.has(identity.workKey)) {
      return this.conflict(normalized.aliases, [identity.workKey]);
    }
    this.store(identity);
    return { status: "created", identity: this.copy(identity)! };
  }

  private store(identity: CanonicalWorkIdentity): void {
    this.identities.set(identity.workKey, identity);
    for (const alias of identity.aliases) this.aliasToWorkKey.set(alias, identity.workKey);
  }

  private conflict(aliases: string[], workKeys: WorkKey[]): CanonicalIdentityResult {
    return {
      status: "conflict",
      conflict: {
        code: "CANONICAL_IDENTITY_CONFLICT",
        aliases: sortedUnique(aliases),
        workKeys: sortedUnique(workKeys),
      },
    };
  }

  private copy(identity: CanonicalWorkIdentity | undefined): CanonicalWorkIdentity | undefined {
    return identity
      ? { ...identity, ids: { ...identity.ids }, aliases: [...identity.aliases] }
      : undefined;
  }
}
