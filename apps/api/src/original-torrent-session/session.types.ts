import type {
  TorrentDiscoveryQuery,
  TorrentCandidate,
} from '@media-engine/core';
import type {
  OriginalTorrentFile,
  OriginalTorrentFileTarget,
  OriginalTorrentSource,
  OriginalTorrentStatus,
} from '../original-torrent-runtime';

export type OriginalTorrentSessionState =
  | 'adding'
  | 'waiting_metadata'
  | 'selection_required'
  | 'ready'
  | 'failed'
  | 'stopped'
  | 'expired';

export type OriginalTorrentSessionErrorCode =
  | 'torrserver_unavailable'
  | 'torrent_source_invalid'
  | 'torrent_metadata_timeout'
  | 'torrent_pieces_unavailable'
  | 'torrent_file_not_found'
  | 'torrent_file_selection_required'
  | 'torrent_stream_failed'
  | 'session_stopped'
  | 'session_expired';

export interface TorrentObservationSelection {
  provider: string;
  id: string;
}

export interface CreateOriginalTorrentSessionInput {
  query: TorrentDiscoveryQuery;
  observation: TorrentObservationSelection;
}

export interface OriginalTorrentSessionFile {
  id: number;
  path: string;
  length: number;
}

export interface OriginalTorrentSessionFailure {
  code: OriginalTorrentSessionErrorCode;
  message: string;
  transient: boolean;
}

export interface OriginalTorrentSessionSnapshot {
  id: string;
  state: OriginalTorrentSessionState;
  observation: TorrentObservationSelection;
  title?: string;
  files?: OriginalTorrentSessionFile[];
  selectedFile?: OriginalTorrentSessionFile;
  streamUrl?: string;
  error?: OriginalTorrentSessionFailure;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ResolvedTorrentObservation {
  candidate: TorrentCandidate;
  source: OriginalTorrentSource;
}

export interface OriginalTorrentSourceResolver {
  resolve(
    input: CreateOriginalTorrentSessionInput,
    signal: AbortSignal,
  ): Promise<ResolvedTorrentObservation>;
}

export interface OriginalTorrentRuntimeAdapter {
  health(options?: { signal?: AbortSignal }): Promise<unknown>;
  add(
    source: OriginalTorrentSource,
    options?: { signal?: AbortSignal },
  ): Promise<OriginalTorrentStatus>;
  waitForMetadata(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<OriginalTorrentStatus>;
  resolveFileTarget(
    hash: string,
    fileId: number,
    options?: { signal?: AbortSignal },
  ): Promise<OriginalTorrentFileTarget>;
  drop(hash: string, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface OriginalTorrentSessionRecord {
  id: string;
  state: OriginalTorrentSessionState;
  observation: TorrentObservationSelection;
  title?: string;
  files?: OriginalTorrentFile[];
  selectedFile?: OriginalTorrentFile;
  target?: OriginalTorrentFileTarget;
  error?: OriginalTorrentSessionFailure;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  terminalAtMs?: number;
  controller: AbortController;
  resource?: SharedTorrentResource;
  resourceReleased: boolean;
  selectionFileId?: number;
  selectionInProgress?: Promise<OriginalTorrentSessionSnapshot>;
  streamCapability?: string;
}

export interface SharedTorrentResource {
  hash: string;
  source: OriginalTorrentSource;
  references: Set<string>;
  phase: 'adding' | 'waiting_metadata' | 'ready' | 'failed' | 'closing';
  controller: AbortController;
  added: boolean;
  preparation: Promise<OriginalTorrentStatus>;
  closing?: Promise<void>;
}

export interface OriginalTorrentStreamAccess {
  sessionId: string;
  target: OriginalTorrentFileTarget;
  expiresAtMs: number;
  signal: AbortSignal;
}
