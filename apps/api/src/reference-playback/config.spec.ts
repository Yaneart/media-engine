import {
  DEFAULT_TORRENT_CANDIDATE_CATALOG_SIZE,
  DEFAULT_TORRENT_CANDIDATE_TTL_MS,
  DEFAULT_TORRENT_PLAYBACK_MAX_OFFERED_FILES,
  DEFAULT_TORRENT_PLAYBACK_MAX_SESSIONS,
  DEFAULT_TORRENT_PLAYBACK_MAX_STARTING,
  DEFAULT_TORRENT_PLAYBACK_SESSION_TTL_MS,
  DEFAULT_TORRENT_PLAYBACK_START_TIMEOUT_MS,
  readTorrentPlaybackConfig,
} from './config';

describe('readTorrentPlaybackConfig', () => {
  it('returns bounded defaults', () => {
    expect(readTorrentPlaybackConfig({})).toEqual({
      candidateTtlMs: DEFAULT_TORRENT_CANDIDATE_TTL_MS,
      maxCandidates: DEFAULT_TORRENT_CANDIDATE_CATALOG_SIZE,
      sessionTtlMs: DEFAULT_TORRENT_PLAYBACK_SESSION_TTL_MS,
      startTimeoutMs: DEFAULT_TORRENT_PLAYBACK_START_TIMEOUT_MS,
      maxSessions: DEFAULT_TORRENT_PLAYBACK_MAX_SESSIONS,
      maxStartingSessions: DEFAULT_TORRENT_PLAYBACK_MAX_STARTING,
      maxOfferedFiles: DEFAULT_TORRENT_PLAYBACK_MAX_OFFERED_FILES,
    });
  });

  it('accepts exact bounded overrides', () => {
    expect(
      readTorrentPlaybackConfig({
        MEDIA_ENGINE_TORRENT_CANDIDATE_TTL_MS: '60000',
        MEDIA_ENGINE_TORRENT_CANDIDATE_CATALOG_SIZE: '20',
        MEDIA_ENGINE_TORRENT_PLAYBACK_SESSION_TTL_MS: '120000',
        MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS: '5000',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS: '4',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING: '3',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_OFFERED_FILES: '25',
      }),
    ).toEqual({
      candidateTtlMs: 60_000,
      maxCandidates: 20,
      sessionTtlMs: 120_000,
      startTimeoutMs: 5_000,
      maxSessions: 4,
      maxStartingSessions: 3,
      maxOfferedFiles: 25,
    });
  });

  it.each([
    ['MEDIA_ENGINE_TORRENT_CANDIDATE_TTL_MS', '999'],
    ['MEDIA_ENGINE_TORRENT_CANDIDATE_CATALOG_SIZE', '0'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_SESSION_TTL_MS', '1.5'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS', '-1'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS', '65'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING', '17'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_OFFERED_FILES', '1001'],
  ])('rejects invalid %s values', (name, value) => {
    expect(() => readTorrentPlaybackConfig({ [name]: value })).toThrow(name);
  });

  it('rejects a starting-session limit above the total limit', () => {
    expect(() =>
      readTorrentPlaybackConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_SESSIONS: '2',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STARTING: '3',
      }),
    ).toThrow('must not exceed');
  });
});
