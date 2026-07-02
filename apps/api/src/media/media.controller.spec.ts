import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  MediaEngineError,
  sampleMovie,
  type MediaEngine,
  type SearchResponse,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import { MediaModule } from './media.module';

describe('MediaController', () => {
  let app: INestApplication;
  let mediaEngine: jest.Mocked<Pick<MediaEngine, 'search'>>;

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

  beforeEach(async () => {
    mediaEngine = {
      search: jest.fn().mockResolvedValue(searchResponse),
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
});
