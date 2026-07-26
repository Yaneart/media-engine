import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentMediaItem,
} from '@media-engine/core';

export type TorrentPlaybackSessionState =
  | 'starting'
  | 'file_selection_required'
  | 'ready'
  | 'conversion_required'
  | 'failed'
  | 'stopped';

export type TorrentPlaybackCompatibility =
  'direct' | 'remux_required' | 'transcode_required' | 'unknown';

export type TorrentPlaybackMode = 'direct' | 'remux';

export interface TorrentPlaybackFile {
  id: number;
  path: string;
  length: number;
  compatibility: TorrentPlaybackCompatibility;
}

export interface TorrentPlaybackSessionErrorInfo {
  code: string;
  message: string;
}

export interface TorrentPlaybackSessionSnapshot {
  id: string;
  streamUrl: string;
  state: TorrentPlaybackSessionState;
  provider: string;
  candidateId: string;
  infoHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  compatibility?: TorrentPlaybackCompatibility;
  playbackMode?: TorrentPlaybackMode;
  selectedFile?: TorrentPlaybackFile;
  files?: TorrentPlaybackFile[];
  error?: TorrentPlaybackSessionErrorInfo;
}

export interface TorrentPlaybackStreamSource {
  target: {
    url: URL;
    kind: 'torrserver' | 'media_worker';
    hash?: string;
    fileId?: number;
  };
  file: TorrentPlaybackFile;
  signal: AbortSignal;
}

export interface CreateTorrentPlaybackSessionInput {
  provider: string;
  candidateId: string;
  fileId?: number;
}

export interface CataloguedTorrentCandidate {
  candidate: TorrentCandidate;
  query: TorrentDiscoveryQuery;
  item?: TorrentMediaItem;
  recordedAt: string;
  expiresAt: string;
}
