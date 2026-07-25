import {
  DEFAULT_TORRENT_PLAYBACK_MAX_STREAMS,
  DEFAULT_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS,
  readTorrentPlaybackStreamConfig,
} from './stream-config';

describe('torrent playback stream configuration', () => {
  it('uses bounded defaults and accepts exact overrides', () => {
    expect(readTorrentPlaybackStreamConfig({})).toEqual({
      maxStreams: DEFAULT_TORRENT_PLAYBACK_MAX_STREAMS,
      idleTimeoutMs: DEFAULT_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS,
    });
    expect(
      readTorrentPlaybackStreamConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS: '3',
        MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS: '15000',
      }),
    ).toEqual({ maxStreams: 3, idleTimeoutMs: 15_000 });
  });

  it.each([
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS', '0'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS', '33'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS', '999'],
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS', '1.5'],
  ] as const)('rejects invalid %s values', (name, value) => {
    expect(() => readTorrentPlaybackStreamConfig({ [name]: value })).toThrow(
      name,
    );
  });
});
