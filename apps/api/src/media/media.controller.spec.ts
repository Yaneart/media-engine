import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  type DetailsResponse,
  type MediaAvailability,
  MediaEngineError,
  sampleMovie,
  type MediaEngine,
  type ProviderInfo,
  type SearchResponse,
  type StreamingProviderInfo,
  type TorrentDiscoveryResponse,
  type TorrentProviderInfo,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import { MediaModule } from './media.module';

describe('MediaController', () => {
  let app: INestApplication<App>;
  let mediaEngine: jest.Mocked<
    Pick<
      MediaEngine,
      | 'search'
      | 'getDetails'
      | 'getAvailability'
      | 'getProviders'
      | 'getStreamingProviders'
      | 'discoverTorrents'
      | 'getTorrentProviders'
    >
  >;

  const searchResponse: SearchResponse = {
    query: {
      title: 'Interstellar',
      type: 'movie',
      year: 2014,
      imdb: 'tt0816692',
      limit: 2,
      language: 'ru',
    },
    results: [
      {
        item: sampleMovie,
        score: 1,
        sources: [{ provider: 'mock', ids: sampleMovie.ids }],
      },
    ],
    meta: {
      providers: {
        requested: ['mock'],
        successful: ['mock'],
        failed: [],
      },
      cached: false,
      tookMs: 1,
    },
  };

  const detailsResponse: DetailsResponse = {
    query: {
      imdb: 'tt0816692',
      type: 'movie',
      language: 'ru',
    },
    details: sampleMovie,
    meta: {
      providers: {
        requested: ['mock'],
        successful: ['mock'],
        failed: [],
      },
      cached: false,
      tookMs: 1,
    },
  };

  const providersResponse: ProviderInfo[] = [
    {
      name: 'mock',
      version: '1.0.0',
      kind: 'metadata',
      capabilities: {
        mediaTypes: ['movie'],
        search: {
          byTitle: true,
          byExternalIds: ['imdb'],
        },
        details: {
          byExternalIds: ['imdb'],
        },
        features: ['ratings'],
      },
    },
  ];

  const availabilityResponse: MediaAvailability = {
    query: {
      type: 'anime',
      title: 'Naruto',
      shikimori: '20',
      absoluteEpisodeNumber: 1,
      providers: ['experimental-streaming'],
      language: 'ru',
    },
    item: {
      type: 'anime',
      title: 'Naruto',
      ids: {
        shikimori: '20',
      },
    },
    episodes: [
      {
        absoluteEpisodeNumber: 1,
        options: [],
      },
    ],
    options: [],
    sourceProviders: [],
    checkedAt: '2026-07-05T00:00:00.000Z',
  };

  const streamingProvidersResponse: StreamingProviderInfo[] = [
    {
      name: 'experimental-streaming',
      version: '0.0.0',
      kind: 'streaming',
      capabilities: {
        mediaTypes: ['anime'],
        lookup: {
          byTitle: true,
          byExternalIds: ['shikimori'],
          byEpisode: true,
        },
        features: ['embed', 'translations', 'episode_mapping'],
      },
    },
  ];

  const torrentResponse: TorrentDiscoveryResponse = {
    query: {
      type: 'series',
      title: 'Dark',
      imdb: 'tt5753856',
      seasonNumber: 1,
      episodeNumber: 2,
      providers: ['torrent-catalog'],
      language: 'en',
      limit: 5,
    },
    candidates: [],
    sourceProviders: [],
    checkedAt: '2026-07-22T00:00:00.000Z',
  };

  const torrentProvidersResponse: TorrentProviderInfo[] = [
    {
      name: 'torrent-catalog',
      version: '1.0.0',
      kind: 'torrent',
      capabilities: {
        mediaTypes: ['movie', 'series'],
        lookup: {
          byTitle: true,
          byExternalIds: ['imdb'],
          byEpisode: true,
        },
        features: ['magnet', 'file_list', 'peer_stats'],
      },
    },
  ];

  beforeEach(async () => {
    mediaEngine = {
      search: jest.fn().mockResolvedValue(searchResponse),
      getDetails: jest.fn().mockResolvedValue(detailsResponse),
      getAvailability: jest.fn().mockResolvedValue(availabilityResponse),
      getProviders: jest.fn().mockReturnValue(providersResponse),
      getStreamingProviders: jest
        .fn()
        .mockReturnValue(streamingProvidersResponse),
      discoverTorrents: jest.fn().mockResolvedValue(torrentResponse),
      getTorrentProviders: jest.fn().mockReturnValue(torrentProvidersResponse),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MediaModule],
    })
      .overrideProvider(MEDIA_ENGINE)
      .useValue(mediaEngine)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('maps GET /media/search query parameters to MediaEngine.search', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({
        title: ' Interstellar ',
        type: 'movie',
        year: '2014',
        imdb: ' tt0816692 ',
        limit: '2',
        language: 'ru',
      })
      .expect(200)
      .expect(searchResponse);

    expect(mediaEngine.search).toHaveBeenCalledWith(
      {
        title: 'Interstellar',
        type: 'movie',
        year: 2014,
        imdb: 'tt0816692',
        limit: 2,
        language: 'ru',
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('supports ids.* external ID query parameters', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({
        'ids.shikimori': '5114',
      })
      .expect(200);

    expect(mediaEngine.search).toHaveBeenCalledWith(
      { shikimori: '5114' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('falls back to a nested external ID when the top-level shortcut is blank', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({ imdb: '   ', 'ids.imdb': ' tt0816692 ' })
      .expect(200);

    expect(mediaEngine.search).toHaveBeenCalledWith(
      { imdb: 'tt0816692' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('preserves nested-only external IDs in search queries', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({ 'ids.worldArt': ' 12345 ' })
      .expect(200);

    expect(mediaEngine.search).toHaveBeenCalledWith(
      { ids: { worldArt: '12345' } },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns 400 for invalid numeric query parameters', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({
        title: 'Interstellar',
        limit: 'many',
      })
      .expect(400);

    expect(mediaEngine.search).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid core search queries', async () => {
    mediaEngine.search.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message: 'Search query must include title or external ids.',
      }),
    );

    await request(app.getHttpServer()).get('/media/search').expect(400);
  });

  it('returns 503 when all selected search providers fail', async () => {
    mediaEngine.search.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'PROVIDER_ERROR',
        message: 'All search providers failed.',
      }),
    );

    await request(app.getHttpServer())
      .get('/media/search')
      .query({ title: 'Interstellar' })
      .expect(503);
  });

  it('maps GET /media/details query parameters to MediaEngine.getDetails', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({
        imdb: ' tt0816692 ',
        type: 'movie',
        language: 'ru',
      })
      .expect(200)
      .expect(detailsResponse);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith(
      {
        imdb: 'tt0816692',
        type: 'movie',
        language: 'ru',
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('supports ids.* external ID parameters for details lookup', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({
        'ids.tmdb': '157336',
      })
      .expect(200);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith(
      { tmdb: '157336' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('preserves nested-only external IDs in details queries', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({ 'ids.worldArt': '12345' })
      .expect(200);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith(
      { ids: { worldArt: '12345' } },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns 400 for invalid details media type', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({
        imdb: 'tt0816692',
        type: 'book',
      })
      .expect(400);

    expect(mediaEngine.getDetails).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid core details queries', async () => {
    mediaEngine.getDetails.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message: 'Details query must include external ids.',
      }),
    );

    await request(app.getHttpServer()).get('/media/details').expect(400);
  });

  it('returns 400 for unsupported id-only details lookup', async () => {
    mediaEngine.getDetails.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message:
          'Details query id is not a supported global lookup. Use ids or a named external ID shortcut.',
      }),
    );

    await request(app.getHttpServer())
      .get('/media/details')
      .query({ id: 'movie-1' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe(
          'Details query id is not a supported global lookup. Use ids or a named external ID shortcut.',
        );
      });

    expect(mediaEngine.getDetails).toHaveBeenCalledWith(
      { id: 'movie-1' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns 503 when all selected details providers fail', async () => {
    mediaEngine.getDetails.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'PROVIDER_ERROR',
        message: 'All details providers failed.',
      }),
    );

    await request(app.getHttpServer())
      .get('/media/details')
      .query({ imdb: 'tt0816692' })
      .expect(503);
  });

  it('maps GET /media/availability query parameters to MediaEngine.getAvailability', async () => {
    await request(app.getHttpServer())
      .get('/media/availability')
      .query({
        title: ' Naruto ',
        type: 'anime',
        shikimori: ' 20 ',
        absoluteEpisodeNumber: '1',
        providers: 'experimental-streaming,mirror',
        language: 'ru',
      })
      .expect(200)
      .expect(availabilityResponse);

    expect(mediaEngine.getAvailability).toHaveBeenCalledWith(
      {
        title: 'Naruto',
        type: 'anime',
        shikimori: '20',
        absoluteEpisodeNumber: 1,
        providers: ['experimental-streaming', 'mirror'],
        language: 'ru',
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('supports ids.* external ID parameters for availability lookup', async () => {
    await request(app.getHttpServer())
      .get('/media/availability')
      .query({
        type: 'anime',
        'ids.shikimori': '20',
      })
      .expect(200);

    expect(mediaEngine.getAvailability).toHaveBeenCalledWith(
      { type: 'anime', shikimori: '20' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('preserves nested-only external IDs in availability queries', async () => {
    await request(app.getHttpServer())
      .get('/media/availability')
      .query({ type: 'movie', 'ids.worldArt': '12345' })
      .expect(200);

    expect(mediaEngine.getAvailability).toHaveBeenCalledWith(
      { type: 'movie', ids: { worldArt: '12345' } },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns 400 for invalid availability numeric parameters', async () => {
    await request(app.getHttpServer())
      .get('/media/availability')
      .query({
        title: 'Naruto',
        type: 'anime',
        absoluteEpisodeNumber: 'first',
      })
      .expect(400);

    expect(mediaEngine.getAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 when availability type is missing', async () => {
    await request(app.getHttpServer())
      .get('/media/availability')
      .query({ title: 'Naruto' })
      .expect(400);

    expect(mediaEngine.getAvailability).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid core availability queries', async () => {
    mediaEngine.getAvailability.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message: 'Stream query must include title or external ids.',
      }),
    );

    await request(app.getHttpServer())
      .get('/media/availability')
      .query({ type: 'anime' })
      .expect(400);
  });

  it('returns 503 when all selected streaming providers fail', async () => {
    mediaEngine.getAvailability.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'PROVIDER_ERROR',
        message: 'All streaming providers failed.',
      }),
    );

    await request(app.getHttpServer())
      .get('/media/availability')
      .query({ title: 'Naruto', type: 'anime' })
      .expect(503);
  });

  it('maps GET /media/torrents query parameters to MediaEngine.discoverTorrents', async () => {
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({
        title: ' Dark ',
        type: 'series',
        imdb: ' tt5753856 ',
        seasonNumber: '1',
        episodeNumber: '2',
        providers: 'torrent-catalog,mirror',
        language: 'en',
        limit: '5',
      })
      .expect(200)
      .expect(torrentResponse);

    expect(mediaEngine.discoverTorrents).toHaveBeenCalledWith(
      {
        title: 'Dark',
        type: 'series',
        imdb: 'tt5753856',
        seasonNumber: 1,
        episodeNumber: 2,
        providers: ['torrent-catalog', 'mirror'],
        language: 'en',
        limit: 5,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns 400 for invalid torrent query parameters before core execution', async () => {
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({ type: 'movie', title: 'Dune', limit: 'many' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({ title: 'Dune' })
      .expect(400);

    expect(mediaEngine.discoverTorrents).not.toHaveBeenCalled();
  });

  it('maps torrent core query and provider failures to HTTP errors', async () => {
    mediaEngine.discoverTorrents.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message: 'Torrent discovery query must include title or external ids.',
      }),
    );
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({ type: 'movie' })
      .expect(400);

    mediaEngine.discoverTorrents.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'PROVIDER_ERROR',
        message: 'All torrent providers failed.',
      }),
    );
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({ type: 'movie', title: 'Dune' })
      .expect(503);
  });

  it('returns safe provider metadata from GET /providers', async () => {
    await request(app.getHttpServer())
      .get('/providers')
      .expect(200)
      .expect(providersResponse);

    expect(mediaEngine.getProviders).toHaveBeenCalledWith();
  });

  it('returns safe streaming provider metadata from GET /providers/streaming', async () => {
    await request(app.getHttpServer())
      .get('/providers/streaming')
      .expect(200)
      .expect(streamingProvidersResponse);

    expect(mediaEngine.getStreamingProviders).toHaveBeenCalledWith();
  });

  it('returns safe torrent provider metadata from GET /providers/torrent', async () => {
    await request(app.getHttpServer())
      .get('/providers/torrent')
      .expect(200)
      .expect(torrentProvidersResponse);

    expect(mediaEngine.getTorrentProviders).toHaveBeenCalledWith();
  });
});
