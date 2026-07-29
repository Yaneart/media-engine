import type { ExecutionContext } from '@nestjs/common';
import {
  OriginalTorrentSessionTokenGuard,
  readOriginalTorrentSessionAuthConfig,
} from './session-auth';

const TOKEN = 'test-original-torrent-token-123456';

describe('original torrent session authentication', () => {
  it('keeps sessions disabled without a token and accepts a bounded token', () => {
    expect(readOriginalTorrentSessionAuthConfig({})).toEqual({});
    expect(
      readOriginalTorrentSessionAuthConfig({
        MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN: TOKEN,
      }),
    ).toEqual({ token: TOKEN });
  });

  it.each(['short', ` ${TOKEN}`, `${TOKEN}\n`, 'x'.repeat(513)])(
    'rejects an unsafe token: %s',
    (token) => {
      expect(() =>
        readOriginalTorrentSessionAuthConfig({
          MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN: token,
        }),
      ).toThrow('MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN');
    },
  );

  it('uses constant-shape bearer authorization and emits a challenge', () => {
    const response = { setHeader: jest.fn() };
    const guard = new OriginalTorrentSessionTokenGuard({ token: TOKEN });

    expect(guard.canActivate(createContext(`Bearer ${TOKEN}`, response))).toBe(
      true,
    );
    expect(() =>
      guard.canActivate(createContext('Bearer wrong', response)),
    ).toThrow('A valid original torrent session token is required.');
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer',
    );
  });

  it('fails closed when server authentication is not configured', () => {
    const guard = new OriginalTorrentSessionTokenGuard({});

    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      'Original torrent sessions are disabled',
    );
  });
});

function createContext(
  authorization?: string,
  response: { setHeader: jest.Mock } = { setHeader: jest.fn() },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}
