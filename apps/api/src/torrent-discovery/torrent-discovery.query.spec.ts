import { BadRequestException } from '@nestjs/common';
import { parseTorrentDiscoveryQuery } from './torrent-discovery.query';

describe('parseTorrentDiscoveryQuery', () => {
  it('normalizes the complete supported HTTP query shape', () => {
    expect(
      parseTorrentDiscoveryQuery({
        type: 'series',
        title: ' Dune: Prophecy ',
        alternativeTitles: [' Дюна: Пророчество ', 'DUNE: PROPHECY'],
        year: '2024',
        seasonNumber: '1',
        episodeNumber: '2',
        providers: [' yts-torrent,jacred-torrent ', 'jacred-torrent'],
        language: ' en ',
        limit: '25',
        imdb: ' ',
        'ids.imdb': ' tt10466872 ',
        tmdb: ' 90228 ',
        'ids.kinopoisk': ' 804093 ',
        shikimori: ' 56512 ',
        'ids.myAnimeList': ' 53439 ',
        aniList: ' 162582 ',
        'ids.worldArt': ' 12345 ',
      }),
    ).toEqual({
      type: 'series',
      title: 'Dune: Prophecy',
      alternativeTitles: ['Дюна: Пророчество', 'DUNE: PROPHECY'],
      year: 2024,
      seasonNumber: 1,
      episodeNumber: 2,
      providers: ['yts-torrent', 'jacred-torrent'],
      language: 'en',
      limit: 25,
      imdb: 'tt10466872',
      tmdb: '90228',
      kinopoisk: '804093',
      shikimori: '56512',
      myAnimeList: '53439',
      aniList: '162582',
      ids: { worldArt: '12345' },
    });
  });

  it.each([
    [{ title: 'Dune' }, 'type is required'],
    [{ type: 'book', title: 'Dune' }, 'type must be'],
    [{ type: 'movie', title: 'Dune', limit: '1e2' }, 'base-10 integer'],
    [{ type: 'movie', title: 'Dune', limit: '101' }, 'between 0 and 100'],
    [{ type: 'movie', title: 'Dune', year: '-1' }, 'non-negative'],
    [{ type: 'movie', title: 'Dune', debug: '1' }, 'Unsupported'],
    [{ type: ['movie', 'series'], title: 'Dune' }, 'single string'],
    [{ type: 'movie', title: 'Dune', providers: [{}] }, 'only strings'],
    [
      { type: 'movie', title: 'Dune', alternativeTitles: [{}] },
      'must be a single string',
    ],
  ])('rejects malformed or unsupported input %#', (query, message) => {
    expect(() => parseTorrentDiscoveryQuery(query)).toThrow(
      new RegExp(message),
    );
  });

  it('rejects oversized bounded fields before invoking core', () => {
    expect(() =>
      parseTorrentDiscoveryQuery({
        type: 'movie',
        title: 'x'.repeat(301),
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      parseTorrentDiscoveryQuery({
        type: 'movie',
        title: 'Dune',
        providers: Array.from({ length: 101 }, (_, index) => `p${index}`),
      }),
    ).toThrow(/at most 100 names/);

    expect(() =>
      parseTorrentDiscoveryQuery({
        type: 'movie',
        title: 'Dune',
        alternativeTitles: Array.from(
          { length: 21 },
          (_, index) => `Dune ${index}`,
        ),
      }),
    ).toThrow(/at most 20 values/);
  });
});
