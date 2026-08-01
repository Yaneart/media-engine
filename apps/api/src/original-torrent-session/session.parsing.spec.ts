import { OriginalTorrentSessionInputError } from './session.errors';
import {
  parseCreateOriginalTorrentSessionBody,
  parseOriginalTorrentFileSelectionBody,
  parseOriginalTorrentSessionId,
} from './session.parsing';

describe('original torrent session input parsing', () => {
  it('accepts a bounded media identity and opaque provider observation', () => {
    expect(
      parseCreateOriginalTorrentSessionBody({
        query: {
          type: 'series',
          title: ' Example ',
          alternativeTitles: [' Пример ', 'Example title'],
          year: 2026,
          seasonNumber: 1,
          episodeNumber: 2,
          tmdb: ' 123 ',
          kinopoisk: ' 456 ',
          shikimori: ' 789 ',
          myAnimeList: ' 1011 ',
          aniList: ' 1213 ',
          ids: { imdb: ' tt1234567 ', worldArt: '42' },
        },
        observation: { provider: ' test-torrent ', id: ' opaque:id ' },
      }),
    ).toEqual({
      query: {
        type: 'series',
        title: 'Example',
        alternativeTitles: ['Пример', 'Example title'],
        year: 2026,
        seasonNumber: 1,
        episodeNumber: 2,
        tmdb: '123',
        kinopoisk: '456',
        shikimori: '789',
        myAnimeList: '1011',
        aniList: '1213',
        ids: { imdb: 'tt1234567', worldArt: '42' },
      },
      observation: { provider: 'test-torrent', id: 'opaque:id' },
    });
  });

  it.each([
    null,
    {},
    {
      query: { type: 'movie' },
      observation: { provider: 'x', id: 'y' },
      magnet: 'raw',
    },
    {
      query: { type: 'movie', providers: ['x'] },
      observation: { provider: 'x', id: 'y' },
    },
    {
      query: { type: 'movie' },
      observation: { provider: 'x', id: 'y', path: '/tmp/x' },
    },
    { query: { type: 'book' }, observation: { provider: 'x', id: 'y' } },
    {
      query: { type: 'movie', year: '2026' },
      observation: { provider: 'x', id: 'y' },
    },
    {
      query: { type: 'movie', alternativeTitles: 'Alias' },
      observation: { provider: 'x', id: 'y' },
    },
  ])(
    'rejects raw, unknown, missing, or incorrectly typed input %#',
    (value) => {
      expect(() => parseCreateOriginalTorrentSessionBody(value)).toThrow(
        OriginalTorrentSessionInputError,
      );
    },
  );

  it('accepts only one positive numeric offered file ID', () => {
    expect(parseOriginalTorrentFileSelectionBody({ fileId: 7 })).toBe(7);
    expect(parseOriginalTorrentFileSelectionBody({ fileId: 1_000_000 })).toBe(
      1_000_000,
    );
    expect(() =>
      parseOriginalTorrentFileSelectionBody({ fileId: 7, path: 'movie.mkv' }),
    ).toThrow(/unsupported fields/u);
    expect(() =>
      parseOriginalTorrentFileSelectionBody({ fileId: '7' }),
    ).toThrow(/integer/u);
    expect(() => parseOriginalTorrentFileSelectionBody({ fileId: 0 })).toThrow(
      /integer/u,
    );
    expect(() =>
      parseOriginalTorrentFileSelectionBody({ fileId: 1_000_001 }),
    ).toThrow(/integer/u);
  });

  it('accepts only exact bounded random session IDs', () => {
    const id = 'A'.repeat(32);
    expect(parseOriginalTorrentSessionId(id)).toBe(id);
    expect(() => parseOriginalTorrentSessionId('../internal')).toThrow(
      /Session ID/u,
    );
    expect(() => parseOriginalTorrentSessionId('A'.repeat(33))).toThrow(
      /Session ID/u,
    );
  });
});
