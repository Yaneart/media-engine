import type { SharedTorrentResource } from './torrent-resource-pool';
import type {
  CreateTorrentPlaybackSessionInput,
  TorrentPlaybackSessionSnapshot,
  TorrentPlaybackSessionState,
} from './types';

export interface InternalTorrentPlaybackSession {
  id: string;
  state: TorrentPlaybackSessionState;
  infoHash: string;
  expiresAtMs: number;
  controller: AbortController;
  expiryTimer?: ReturnType<typeof setTimeout>;
  resource?: SharedTorrentResource;
  resourceReleased: boolean;
  snapshot: TorrentPlaybackSessionSnapshot;
}

export function createSessionRecord(
  id: string,
  input: CreateTorrentPlaybackSessionInput,
  infoHash: string,
  now: number,
  sessionTtlMs: number,
): InternalTorrentPlaybackSession {
  const expiresAtMs = now + sessionTtlMs;
  return {
    id,
    state: 'starting',
    infoHash,
    expiresAtMs,
    controller: new AbortController(),
    resourceReleased: false,
    snapshot: {
      id,
      state: 'starting',
      provider: input.provider,
      candidateId: input.candidateId,
      infoHash,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  };
}

export function updateSessionRecord(
  session: InternalTorrentPlaybackSession,
  state: TorrentPlaybackSessionState,
  now: number,
  values: Pick<
    TorrentPlaybackSessionSnapshot,
    'compatibility' | 'selectedFile' | 'files'
  > = {},
): TorrentPlaybackSessionSnapshot {
  session.state = state;
  session.snapshot = {
    ...session.snapshot,
    state,
    updatedAt: new Date(now).toISOString(),
    ...values,
  };
  return structuredClone(session.snapshot);
}

export function failSessionRecord(
  session: InternalTorrentPlaybackSession,
  now: number,
  code: string,
  message: string,
): TorrentPlaybackSessionSnapshot {
  const snapshot = updateSessionRecord(session, 'failed', now);
  session.snapshot = { ...snapshot, error: { code, message } };
  return structuredClone(session.snapshot);
}
