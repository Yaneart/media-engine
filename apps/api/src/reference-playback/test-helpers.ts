import type {
  TorrentCandidate,
  TorrentDiscoveryQuery,
  TorrentDiscoveryResponse,
} from '@media-engine/core';
import type { TorrentPlaybackConfig } from './config';
import type { TorrentPlaybackTorrServerClient } from './session-service';
import type { TorrServerFile, TorrServerTorrent } from './torrserver';

export const TEST_HASH = 'a'.repeat(40);
export const TEST_MAGNET = `magnet:?xt=urn:btih:${TEST_HASH}&dn=Example`;

export const TEST_PLAYBACK_CONFIG: TorrentPlaybackConfig = {
  candidateTtlMs: 60_000,
  maxCandidates: 20,
  sessionTtlMs: 60_000,
  startTimeoutMs: 10_000,
  maxSessions: 4,
  maxStartingSessions: 2,
  maxOfferedFiles: 10,
};

export function torrentCandidate(
  values: Partial<TorrentCandidate> = {},
): TorrentCandidate {
  return {
    id: 'candidate-1',
    provider: 'test-torrent',
    title: 'Example Movie 2026',
    infoHash: TEST_HASH.toUpperCase(),
    handoff: { kind: 'magnet', uri: TEST_MAGNET },
    availability: 'available',
    ...values,
  };
}

export function torrentResponse(
  candidates: TorrentCandidate[],
  query: TorrentDiscoveryQuery = {
    type: 'movie',
    title: 'Example Movie',
    year: 2026,
  },
): TorrentDiscoveryResponse {
  return {
    query,
    item: { type: query.type, title: query.title, year: query.year },
    candidates,
    sourceProviders: [],
    checkedAt: '2026-07-25T00:00:00.000Z',
  };
}

export function torrServerTorrent(
  files: TorrServerFile[] = [
    { id: 1, path: 'Example.Movie.2026.mp4', length: 1_000_000 },
  ],
): TorrServerTorrent {
  return {
    hash: TEST_HASH,
    state: 2,
    stateLabel: 'working',
    name: 'Example Movie 2026',
    loadedSize: 0,
    torrentSize: files.reduce((total, file) => total + file.length, 0),
    files,
  };
}

export function mockTorrServerClient(
  torrent: TorrServerTorrent = torrServerTorrent(),
): jest.Mocked<TorrentPlaybackTorrServerClient> {
  return {
    add: jest.fn().mockResolvedValue(torrent),
    waitForMetadata: jest.fn().mockResolvedValue(torrent),
    drop: jest.fn().mockResolvedValue(undefined),
  };
}
