export type OriginalTorrentSource =
  | {
      kind: 'magnet';
      uri: string;
      expectedHash: string;
      title?: string;
    }
  | {
      kind: 'torrent_file';
      bytes: Uint8Array;
      expectedHash: string;
      title?: string;
    };

export type TorrServerTorrentState = 0 | 1 | 2 | 3 | 4 | 5;

export interface OriginalTorrentFile {
  id: number;
  path: string;
  length: number;
}

export interface OriginalTorrentStatus {
  hash: string;
  state: TorrServerTorrentState;
  stateLabel: string;
  name?: string;
  loadedSize: number;
  torrentSize: number;
  files: OriginalTorrentFile[];
}

export type OriginalTorrentOwnership = 'application' | 'external';

export interface OriginalTorrentRuntimeLease {
  hash: string;
  timestamp: number;
  ownership: OriginalTorrentOwnership;
}

export interface AcquiredOriginalTorrent extends OriginalTorrentStatus {
  lease: OriginalTorrentRuntimeLease;
}

export interface TorrServerRuntimeHealth {
  version: string;
  compatible: true;
}

export interface OriginalTorrentFileTarget {
  url: URL;
  hash: string;
  fileId: number;
  path: string;
  length: number;
  headerTimeoutMs: number;
  inactivityTimeoutMs: number;
}

export interface OriginalTorrentOperationOptions {
  signal?: AbortSignal;
}

export interface TorrServerAdapterEvent {
  operation:
    | 'health'
    | 'recover'
    | 'add'
    | 'get'
    | 'metadata'
    | 'target'
    | 'validate'
    | 'drop';
  outcome: 'success' | 'failure';
  code?: string;
  transient?: boolean;
}
