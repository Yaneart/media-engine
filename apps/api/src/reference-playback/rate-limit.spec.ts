import type { Request } from 'express';
import { isReferencePlaybackRequest } from './rate-limit';

describe('reference playback rate-limit matcher', () => {
  it.each([
    ['GET', '/reference/torrent-playback/health'],
    ['GET', '/reference/torrent-playback/health/'],
    ['POST', '/reference/torrent-playback/sessions'],
    ['GET', `/reference/torrent-playback/sessions/${'a'.repeat(43)}`],
    ['DELETE', `/reference/torrent-playback/sessions/${'a'.repeat(43)}`],
  ])('matches %s %s', (method, path) => {
    expect(isReferencePlaybackRequest({ method, path } as Request)).toBe(true);
  });

  it.each([
    ['POST', '/reference/torrent-playback/health'],
    ['GET', '/reference/torrent-playback/sessions'],
    ['POST', `/reference/torrent-playback/sessions/${'a'.repeat(43)}`],
    ['GET', '/media/torrents'],
    ['GET', '/reference/torrent-playback/sessions/bad/path'],
  ])('ignores %s %s', (method, path) => {
    expect(isReferencePlaybackRequest({ method, path } as Request)).toBe(false);
  });
});
