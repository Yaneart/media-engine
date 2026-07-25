import { readReferencePlaybackHttpConfig } from './http-config';

describe('reference playback HTTP config', () => {
  const token = 'a'.repeat(32);

  it('keeps playback disabled when URL and token are both absent', () => {
    expect(readReferencePlaybackHttpConfig(false, {})).toEqual({
      enabled: false,
    });
  });

  it('enables playback only with a bounded separate token', () => {
    expect(
      readReferencePlaybackHttpConfig(true, {
        MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: token,
      }),
    ).toEqual({ enabled: true, token });
  });

  it.each([
    [true, {}, 'configured together'],
    [
      false,
      { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: token },
      'configured together',
    ],
    [true, { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: 'short' }, '32-512'],
    [true, { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: ` ${token}` }, '32-512'],
    [true, { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: `${token} space` }, '32-512'],
    [true, { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: `${token}\n` }, '32-512'],
    [true, { MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: 'a'.repeat(513) }, '32-512'],
  ] as const)(
    'rejects mismatched or invalid configuration',
    (enabled, env, message) => {
      expect(() => readReferencePlaybackHttpConfig(enabled, env)).toThrow(
        message,
      );
    },
  );
});
