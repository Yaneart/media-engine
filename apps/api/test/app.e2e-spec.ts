import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  sampleMovie,
  type DetailsResponse,
  type MediaEngine,
  type ProviderInfo,
  type SearchResponse,
} from '@media-engine/core';
import { MEDIA_ENGINE } from './../src/media-engine';
import { AppModule } from './../src/app.module';
import { setupOpenApi } from './../src/openapi';

describe('Media Engine API (e2e)', () => {
  let app: INestApplication<App>;
  let mediaEngine: jest.Mocked<
    Pick<MediaEngine, 'search' | 'getDetails' | 'getProviders'>
  >;

  const searchResponse: SearchResponse = {
    query: {
      title: 'Interstellar',
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
      imports: [AppModule],
    })
      .overrideProvider(MEDIA_ENGINE)
      .useValue(mediaEngine)
      .compile();

    app = moduleFixture.createNestApplication();
    setupOpenApi(app);
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      status: 'ok',
      service: 'media-engine-api',
    });
  });

  it('/media/search (GET)', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({ title: 'Interstellar' })
      .expect(200)
      .expect(searchResponse);

    expect(mediaEngine.search).toHaveBeenCalledWith({
      title: 'Interstellar',
    });
  });

  it('/media/details (GET)', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({ imdb: 'tt0816692' })
      .expect(200)
      .expect(detailsResponse);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith({
      imdb: 'tt0816692',
    });
  });

  it('/providers (GET)', async () => {
    await request(app.getHttpServer())
      .get('/providers')
      .expect(200)
      .expect(providersResponse);

    expect(mediaEngine.getProviders).toHaveBeenCalledWith();
  });

  it('/docs-json (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const body: unknown = response.body;

    expect(isOpenApiDocument(body)).toBe(true);

    if (!isOpenApiDocument(body)) {
      throw new Error('Expected OpenAPI document response.');
    }

    expect(body.openapi).toBe('3.0.0');
    expect(body.info).toMatchObject({
      title: 'Media Engine API',
      version: '0.0.0',
    });
    expect(body.paths).toHaveProperty('/health');
    expect(body.paths).toHaveProperty('/media/search');
    expect(body.paths).toHaveProperty('/media/details');
    expect(body.paths).toHaveProperty('/providers');
  });

  afterEach(async () => {
    await app.close();
  });
});

// EN: Narrow the untyped Supertest response body before asserting OpenAPI fields.
// RU: Сужает нетипизированное body из Supertest перед проверкой OpenAPI полей.
function isOpenApiDocument(value: unknown): value is {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const document = value as Record<string, unknown>;

  return (
    typeof document.openapi === 'string' &&
    isRecord(document.info) &&
    isRecord(document.paths)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
