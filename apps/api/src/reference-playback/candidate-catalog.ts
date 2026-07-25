import type { TorrentDiscoveryResponse } from '@media-engine/core';
import type { TorrentPlaybackConfig } from './config';
import type { CataloguedTorrentCandidate } from './types';

const MAX_PROVIDER_LENGTH = 128;
const MAX_CANDIDATE_ID_LENGTH = 1_024;

interface CandidateCatalogDependencies {
  now?: () => number;
}

export class TorrentCandidateCatalog {
  private readonly entries = new Map<string, CataloguedTorrentCandidate>();
  private readonly now: () => number;

  constructor(
    private readonly config: Pick<
      TorrentPlaybackConfig,
      'candidateTtlMs' | 'maxCandidates'
    >,
    dependencies: CandidateCatalogDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  record(response: TorrentDiscoveryResponse): number {
    const now = this.now();
    this.pruneExpired(now);
    let recorded = 0;

    for (const candidate of response.candidates) {
      if (!isSafeKeyPart(candidate.provider, MAX_PROVIDER_LENGTH)) {
        continue;
      }

      if (!isSafeKeyPart(candidate.id, MAX_CANDIDATE_ID_LENGTH)) {
        continue;
      }

      const candidateExpiry = parseFutureTimestamp(candidate.expiresAt, now);

      if (candidate.expiresAt !== undefined && candidateExpiry === undefined) {
        continue;
      }

      const expiresAt = Math.min(
        now + this.config.candidateTtlMs,
        candidateExpiry ?? Number.POSITIVE_INFINITY,
      );
      const key = candidateKey(candidate.provider, candidate.id);
      const entry: CataloguedTorrentCandidate = {
        candidate: structuredClone(candidate),
        query: structuredClone(response.query),
        ...(response.item === undefined
          ? {}
          : { item: structuredClone(response.item) }),
        recordedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      };

      this.entries.delete(key);
      this.entries.set(key, entry);
      recorded += 1;
      this.trimToLimit();
    }

    return recorded;
  }

  get(
    provider: string,
    candidateId: string,
  ): CataloguedTorrentCandidate | undefined {
    const now = this.now();
    this.pruneExpired(now);
    const key = candidateKey(provider, candidateId);
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry);
  }

  get size(): number {
    this.pruneExpired(this.now());
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (Date.parse(entry.expiresAt) <= now) {
        this.entries.delete(key);
      }
    }
  }

  private trimToLimit(): void {
    while (this.entries.size > this.config.maxCandidates) {
      const oldestKey = this.entries.keys().next().value;

      if (oldestKey === undefined) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }
}

export function isSafeCandidateReference(
  provider: string,
  candidateId: string,
): boolean {
  return (
    isSafeKeyPart(provider, MAX_PROVIDER_LENGTH) &&
    isSafeKeyPart(candidateId, MAX_CANDIDATE_ID_LENGTH)
  );
}

function candidateKey(provider: string, candidateId: string): string {
  return JSON.stringify([provider, candidateId]);
}

function isSafeKeyPart(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !hasControlCharacters(value)
  );
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function parseFutureTimestamp(
  value: string | undefined,
  now: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now ? parsed : undefined;
}
