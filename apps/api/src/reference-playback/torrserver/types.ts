export const TORRSERVER_INFO_HASH_PATTERN = /^[a-f0-9]{40}$/;

export type TorrServerTorrentState = 0 | 1 | 2 | 3 | 4 | 5;

export interface TorrServerFile {
  id: number;
  path: string;
  length: number;
}

export interface TorrServerTorrent {
  hash: string;
  state: TorrServerTorrentState;
  stateLabel: string;
  name?: string;
  loadedSize: number;
  torrentSize: number;
  files: TorrServerFile[];
}

export interface TorrServerHealth {
  version: string;
}

export interface TorrServerPlayTarget {
  url: URL;
  hash: string;
  fileId: number;
}

export interface TorrServerRequestOptions {
  signal?: AbortSignal;
}

export interface TorrServerAddOptions extends TorrServerRequestOptions {
  title?: string;
}
