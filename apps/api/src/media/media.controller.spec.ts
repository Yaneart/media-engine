import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  type DetailsResponse,
  MediaEngineError,
  sampleMovie,
  type MediaEngine,
  type ProviderInfo,
  type SearchResponse,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import { MediaModule } from './media.module';

describe('MediaController', () => {
  let app: INestApplication<App>;
  let mediaEngine: jest.Mocked<
    Pick<MediaEngine, 'search' | 'getDetails' | 'getProviders'>
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

  beforeEach(async () => {
    mediaEngine = {
      search: jest.fn().mockResolvedValue(searchResponse),
      getDetails: jest.fn().mockResolvedValue(detailsResponse),
      getProviders: jest.fn().mockReturnValue(providersResponse),
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

    expect(mediaEngine.search).toHaveBeenCalledWith({
      title: 'Interstellar',
      type: 'movie',
      year: 2014,
      imdb: 'tt0816692',
      limit: 2,
      language: 'ru',
    });
  });

  it('supports ids.* external ID query parameters', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({
        'ids.shikimori': '5114',
      })
      .expect(200);

    expect(mediaEngine.search).toHaveBeenCalledWith({
      shikimori: '5114',
    });
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

    expect(mediaEngine.getDetails).toHaveBeenCalledWith({
      imdb: 'tt0816692',
      type: 'movie',
      language: 'ru',
    });
  });

  it('supports ids.* external ID parameters for details lookup', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({
        'ids.tmdb': '157336',
      })
      .expect(200);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith({
      tmdb: '157336',
    });
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
        message: 'Details query must include id or external ids.',
      }),
    );

    await request(app.getHttpServer()).get('/media/details').expect(400);
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

  it('returns safe provider metadata from GET /providers', async () => {
    await request(app.getHttpServer())
      .get('/providers')
      .expect(200)
      .expect(providersResponse);

    expect(mediaEngine.getProviders).toHaveBeenCalledWith();
  });
});
