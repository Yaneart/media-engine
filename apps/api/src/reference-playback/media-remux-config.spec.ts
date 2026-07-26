import {
  DEFAULT_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES,
  DEFAULT_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY,
  DEFAULT_TORRENT_MEDIA_REMUX_TIMEOUT_MS,
  readTorrentMediaRemuxConfig,
} from './media-remux-config';

describe('torrent media remux configuration', () => {
  it('is disabled without an explicit absolute FFmpeg path', () => {
    expect(readTorrentMediaRemuxConfig({})).toBeUndefined();
    expect(
      readTorrentMediaRemuxConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH: ' /usr/bin/ffmpeg ',
      }),
    ).toEqual({
      executablePath: '/usr/bin/ffmpeg',
      outputDirectory: DEFAULT_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY,
      timeoutMs: DEFAULT_TORRENT_MEDIA_REMUX_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES,
    });
  });

  it('accepts bounded worker overrides', () => {
    expect(
      readTorrentMediaRemuxConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH: '/opt/ffmpeg/bin/ffmpeg',
        MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY: '/data/remux',
        MEDIA_ENGINE_TORRENT_MEDIA_REMUX_TIMEOUT_MS: '120000',
        MEDIA_ENGINE_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES: '1073741824',
      }),
    ).toEqual({
      executablePath: '/opt/ffmpeg/bin/ffmpeg',
      outputDirectory: '/data/remux',
      timeoutMs: 120_000,
      maxOutputBytes: 1_073_741_824,
    });
  });

  it.each([
    ['MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH', 'ffmpeg'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY', '../remux'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_REMUX_OUTPUT_DIRECTORY', '/'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_REMUX_TIMEOUT_MS', '9999'],
    ['MEDIA_ENGINE_TORRENT_MEDIA_REMUX_MAX_OUTPUT_BYTES', '1024'],
  ] as const)('rejects invalid %s', (name, value) => {
    expect(() =>
      readTorrentMediaRemuxConfig({
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFMPEG_PATH: '/usr/bin/ffmpeg',
        [name]: value,
      }),
    ).toThrow(name);
  });
});
