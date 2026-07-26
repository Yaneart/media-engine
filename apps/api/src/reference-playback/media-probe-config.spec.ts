import {
  DEFAULT_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS,
  readTorrentPlaybackMediaProbeConfig,
  TORRENT_PLAYBACK_MEDIA_ANALYZE_DURATION_US,
  TORRENT_PLAYBACK_MEDIA_PROBE_MAX_OUTPUT_BYTES,
  TORRENT_PLAYBACK_MEDIA_PROBE_SIZE_BYTES,
} from './media-probe-config';

describe('torrent playback media probe configuration', () => {
  it('stays disabled without an explicit executable and accepts exact overrides', () => {
    expect(readTorrentPlaybackMediaProbeConfig({})).toBeUndefined();
    expect(
      readTorrentPlaybackMediaProbeConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: ' /usr/bin/ffprobe ',
      }),
    ).toEqual({
      executablePath: '/usr/bin/ffprobe',
      timeoutMs: DEFAULT_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS,
      maxOutputBytes: TORRENT_PLAYBACK_MEDIA_PROBE_MAX_OUTPUT_BYTES,
      probeSizeBytes: TORRENT_PLAYBACK_MEDIA_PROBE_SIZE_BYTES,
      analyzeDurationUs: TORRENT_PLAYBACK_MEDIA_ANALYZE_DURATION_US,
    });
    expect(
      readTorrentPlaybackMediaProbeConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: '/opt/ffmpeg/ffprobe',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS: '15000',
      }),
    ).toMatchObject({
      executablePath: '/opt/ffmpeg/ffprobe',
      timeoutMs: 15_000,
    });
  });

  it.each(['ffprobe', './ffprobe', '/tmp/bad\npath'])(
    'rejects unsafe executable path %s',
    (value) => {
      expect(() =>
        readTorrentPlaybackMediaProbeConfig({
          MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: value,
        }),
      ).toThrow('MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH');
    },
  );

  it.each(['999', '60001', '1.5'])('rejects invalid timeout %s', (value) => {
    expect(() =>
      readTorrentPlaybackMediaProbeConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: '/usr/bin/ffprobe',
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS: value,
      }),
    ).toThrow('MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS');
  });
});
