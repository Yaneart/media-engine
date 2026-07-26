import type { TorrentCandidate } from '@media-engine/core';
import { TorrentPlaybackSessionError } from './errors';
import { normalizeAddLink } from './torrserver/parsing';
import type {
  CataloguedTorrentCandidate,
  CreateTorrentPlaybackSessionInput,
} from './types';

export interface ValidatedPlaybackCandidate {
  candidate: TorrentCandidate;
  infoHash: string;
  handoff: string;
}

export function revalidatePlaybackCandidate(
  catalogued: CataloguedTorrentCandidate,
  input: CreateTorrentPlaybackSessionInput,
  now: number,
): ValidatedPlaybackCandidate {
  const { candidate } = catalogued;

  if (
    candidate.provider !== input.provider ||
    candidate.id !== input.candidateId
  ) {
    throw new TorrentPlaybackSessionError(
      'candidate_identity_mismatch',
      'The selected torrent candidate identity is inconsistent.',
    );
  }

  if (
    (candidate.handoff.kind !== 'magnet' &&
      candidate.handoff.kind !== 'torrent_file') ||
    candidate.infoHash === undefined ||
    candidate.handoff.headers !== undefined ||
    candidate.handoff.referer !== undefined ||
    (candidate.handoff.method !== undefined &&
      candidate.handoff.method !== 'GET')
  ) {
    throw new TorrentPlaybackSessionError(
      'candidate_not_playable',
      'The selected torrent candidate cannot be handed to TorServer.',
    );
  }

  const expiresAt = candidate.expiresAt;

  if (expiresAt !== undefined) {
    const parsedExpiry = Date.parse(expiresAt);

    if (!Number.isFinite(parsedExpiry) || parsedExpiry <= now) {
      throw new TorrentPlaybackSessionError(
        'candidate_expired',
        'The selected torrent candidate has expired.',
      );
    }
  }

  const infoHash = candidate.infoHash.trim().toLowerCase();
  let normalizedHandoff: ReturnType<typeof normalizeAddLink>;

  try {
    if (
      candidate.handoff.kind === 'torrent_file' &&
      candidate.provider !== 'yts-torrent'
    ) {
      throw new Error('Unapproved torrent-file provider.');
    }

    normalizedHandoff = normalizeAddLink(
      candidate.handoff.uri,
      candidate.handoff.kind === 'torrent_file' ? infoHash : undefined,
    );
  } catch {
    throw new TorrentPlaybackSessionError(
      'candidate_not_playable',
      'The selected torrent candidate has an invalid handoff.',
    );
  }

  if (normalizedHandoff.infoHash !== infoHash) {
    throw new TorrentPlaybackSessionError(
      'candidate_identity_mismatch',
      'The selected torrent candidate handoff has a different identity.',
    );
  }

  return { candidate, infoHash, handoff: normalizedHandoff.value };
}
