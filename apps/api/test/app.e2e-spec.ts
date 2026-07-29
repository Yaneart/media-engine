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
  type TorrentDiscoveryResponse,
} from '@media-engine/core';
import { MEDIA_ENGINE } from './../src/media-engine';
import { TORRSERVER_ADAPTER } from './../src/original-torrent-runtime';
import { OriginalTorrentSessionService } from './../src/original-torrent-session/session.service';
import { OriginalTorrentStreamGateway } from './../src/original-torrent-stream/stream-gateway';
import { AppModule } from './../src/app.module';
import { configureApiApplication } from './../src/bootstrap';
import type { ApiRuntimeConfig } from './../src/runtime-config';

const testRuntimeConfig: ApiRuntimeConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  corsOrigins: ['http://127.0.0.1:5173'],
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 2,
  },
};

describe('Media Engine API (e2e)', () => {
  let app: INestApplication<App>;
  let mediaEngine: jest.Mocked<
    Pick<
      MediaEngine,
      | 'search'
      | 'getDetails'
      | 'discoverTorrents'
      | 'getProviders'
      | 'getTorrentProviders'
      | 'getProviderHealth'
    >
  >;
  let torrentRuntime: {
    health: jest.Mock;
    add: jest.Mock;
    waitForMetadata: jest.Mock;
    resolveFileTarget: jest.Mock;
    drop: jest.Mock;
  };
  let torrentStreamFetch: jest.Mock;

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

  const torrentResponse: TorrentDiscoveryResponse = {
    query: { type: 'movie', title: 'Dune' },
    candidates: [],
    sourceProviders: [],
    checkedAt: '2026-07-28T00:00:00.000Z',
    meta: {
      providers: { requested: [], successful: [], failed: [] },
      cached: false,
      tookMs: 0,
    },
  };

  beforeEach(async () => {
    mediaEngine = {
      search: jest.fn().mockResolvedValue(searchResponse),
      getDetails: jest.fn().mockResolvedValue(detailsResponse),
      discoverTorrents: jest.fn().mockResolvedValue(torrentResponse),
      getProviders: jest.fn().mockReturnValue(providersResponse),
      getTorrentProviders: jest.fn().mockReturnValue([]),
      getProviderHealth: jest.fn().mockReturnValue([]),
    };
    torrentRuntime = {
      health: jest.fn().mockResolvedValue({
        version: 'MatriX.141',
        compatible: true,
      }),
      add: jest.fn().mockResolvedValue({
        hash: '0123456789abcdef0123456789abcdef01234567',
        state: 2,
        stateLabel: 'torrent working',
        loadedSize: 0,
        torrentSize: 100,
        files: [{ id: 1, path: 'original.unusual', length: 100 }],
      }),
      waitForMetadata: jest.fn(),
      resolveFileTarget: jest.fn().mockResolvedValue({
        url: new URL(
          'http://torrserver:8090/play/0123456789abcdef0123456789abcdef01234567/1',
        ),
        hash: '0123456789abcdef0123456789abcdef01234567',
        fileId: 1,
        path: 'original.unusual',
        length: 100,
        headerTimeoutMs: 45_000,
        inactivityTimeoutMs: 30_000,
      }),
      drop: jest.fn().mockResolvedValue(undefined),
    };
    torrentStreamFetch = jest.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        const range = new Headers(init?.headers).get('range');
        const isHead = init?.method === 'HEAD';

        if (range === 'bytes=10-19') {
          return new Response(isHead ? null : new Uint8Array(10), {
            status: 206,
            headers: {
              'accept-ranges': 'bytes',
              'content-length': '10',
              'content-range': 'bytes 10-19/100',
              'content-type': 'video/mp4',
            },
          });
        }

        return new Response(isHead ? null : new Uint8Array(100), {
          status: 200,
          headers: {
            'accept-ranges': 'bytes',
            'content-length': '100',
            'content-type': 'video/mp4',
          },
        });
      },
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MEDIA_ENGINE)
      .useValue(mediaEngine)
      .overrideProvider(TORRSERVER_ADAPTER)
      .useValue(torrentRuntime)
      .overrideProvider(OriginalTorrentStreamGateway)
      .useFactory({
        factory: (sessions: OriginalTorrentSessionService) =>
          new OriginalTorrentStreamGateway(sessions, {
            fetch: torrentStreamFetch,
          }),
        inject: [OriginalTorrentSessionService],
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApiApplication(app, testRuntimeConfig);
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      status: 'ok',
      service: 'media-engine-api',
      providers: [],
    });
  });

  it('/health/live and /health/ready expose separate probe semantics', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({
      status: 'ok',
      service: 'media-engine-api',
    });

    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({
      status: 'ok',
      service: 'media-engine-api',
      providers: [],
    });
  });

  it('/media/search (GET)', async () => {
    await request(app.getHttpServer())
      .get('/media/search')
      .query({ title: 'Interstellar' })
      .expect(200)
      .expect(searchResponse);

    expect(mediaEngine.search).toHaveBeenCalledWith(
      { title: 'Interstellar' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('/media/details (GET)', async () => {
    await request(app.getHttpServer())
      .get('/media/details')
      .query({ imdb: 'tt0816692' })
      .expect(200)
      .expect(detailsResponse);

    expect(mediaEngine.getDetails).toHaveBeenCalledWith(
      { imdb: 'tt0816692' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('/providers (GET)', async () => {
    await request(app.getHttpServer())
      .get('/providers')
      .expect(200)
      .expect(providersResponse);

    expect(mediaEngine.getProviders).toHaveBeenCalledWith();
  });

  it('exposes opt-in torrent discovery separately from runtime sessions', async () => {
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({ type: 'movie', title: 'Dune' })
      .expect(200)
      .expect(torrentResponse);
    await request(app.getHttpServer())
      .get('/providers/torrent')
      .expect(200)
      .expect([]);

    expect(mediaEngine.discoverTorrents).toHaveBeenCalledWith(
      { type: 'movie', title: 'Dune' },
      { signal: expect.any(AbortSignal) },
    );
    expect(mediaEngine.getTorrentProviders).toHaveBeenCalledTimes(1);
  });

  it('creates, reads, and stops a server-resolved original torrent session', async () => {
    const sessionDiscovery: TorrentDiscoveryResponse = {
      query: { type: 'movie', title: 'Dune', year: 2021 },
      candidates: [
        {
          id: 'yts-torrent:opaque',
          provider: 'yts-torrent',
          title: 'Dune unusual release',
          infoHash: '0123456789abcdef0123456789abcdef01234567',
          handoff: {
            kind: 'magnet',
            uri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
          },
          availability: 'available',
        },
      ],
      sourceProviders: [],
      checkedAt: '2026-07-29T00:00:00.000Z',
    };
    mediaEngine.discoverTorrents.mockResolvedValueOnce(sessionDiscovery);

    const created = await request(app.getHttpServer())
      .post('/media/torrent-sessions')
      .send({
        query: { type: 'movie', title: 'Dune', year: 2021 },
        observation: { provider: 'yts-torrent', id: 'yts-torrent:opaque' },
      })
      .expect(202);
    const sessionId: unknown = created.body.id;
    expect(sessionId).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u));

    await new Promise((resolve) => setImmediate(resolve));
    const ready = await request(app.getHttpServer())
      .get(`/media/torrent-sessions/${String(sessionId)}`)
      .expect(200);
    expect(ready.body).toMatchObject({
      state: 'ready',
      selectedFile: { id: 1, path: 'original.unusual', length: 100 },
      streamUrl: expect.stringMatching(
        /^\/media\/torrent-streams\/[A-Za-z0-9_-]{43}$/u,
      ),
    });
    expect(JSON.stringify(ready.body)).not.toContain('torrserver');
    const streamUrl: unknown = ready.body.streamUrl;

    if (typeof streamUrl !== 'string') {
      throw new Error('Expected the ready session to expose a stream URL.');
    }

    await request(app.getHttpServer())
      .get(streamUrl)
      .set('Range', 'bytes=10-19')
      .expect('Accept-Ranges', 'bytes')
      .expect('Content-Range', 'bytes 10-19/100')
      .expect('Content-Length', '10')
      .expect(206);
    await request(app.getHttpServer())
      .head(streamUrl)
      .expect('Content-Type', 'video/mp4')
      .expect('Content-Length', '100')
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/media/torrent-sessions/${String(sessionId)}`)
      .expect(204);
    await request(app.getHttpServer()).get(streamUrl).expect(410);
    expect(mediaEngine.discoverTorrents).toHaveBeenCalledWith(
      {
        type: 'movie',
        title: 'Dune',
        year: 2021,
        providers: ['yts-torrent'],
        limit: 100,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(torrentRuntime.drop).toHaveBeenCalledWith(
      '0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('adds security headers with separate API and Swagger CSP policies', async () => {
    const apiResponse = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    const docsResponse = await request(app.getHttpServer())
      .get('/docs/')
      .expect(200);

    expect(apiResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(apiResponse.headers['strict-transport-security']).toBeUndefined();
    expect(apiResponse.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(docsResponse.headers['content-security-policy']).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
  });

  it('allows only configured CORS origins', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'http://127.0.0.1:5173')
      .expect('Access-Control-Allow-Origin', 'http://127.0.0.1:5173')
      .expect(200);

    const rejected = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'https://untrusted.example')
      .expect(200);

    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits expensive media routes but not health probes', async () => {
    await request(app.getHttpServer())
      .get('/media/search?title=Dune')
      .expect(200);
    await request(app.getHttpServer())
      .get('/media/details?imdb=tt0816692')
      .expect(200);

    const limited = await request(app.getHttpServer())
      .get('/media/torrents?type=movie&title=Tenet')
      .expect(429);

    expect(limited.headers['ratelimit-limit']).toBe('2');
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    expect(limited.headers['retry-after']).toBeDefined();
    await request(app.getHttpServer()).get('/health/live').expect(200);
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
      version: '0.7.0',
    });
    expect(body.paths).toHaveProperty('/health');
    expect(body.paths).toHaveProperty('/health/live');
    expect(body.paths).toHaveProperty('/health/ready');
    expect(body.paths).toHaveProperty('/media/search');
    expect(body.paths).toHaveProperty('/media/details');
    expect(body.paths).toHaveProperty('/media/availability');
    expect(body.paths).toHaveProperty('/media/torrents');
    expect(body.paths).toHaveProperty('/media/torrent-sessions');
    expect(body.paths).toHaveProperty('/media/torrent-sessions/{id}');
    expect(body.paths).toHaveProperty('/media/torrent-sessions/{id}/selection');
    expect(body.paths).toHaveProperty('/media/torrent-streams/{capability}');
    expect(body.paths).toHaveProperty('/providers');
    expect(body.paths).toHaveProperty('/providers/streaming');
    expect(body.paths).toHaveProperty('/providers/torrent');

    const detailsParameterNames = getOpenApiParameterNames(
      body.paths,
      '/media/details',
    );
    expect(detailsParameterNames).toContain('imdb');
    expect(detailsParameterNames).not.toContain('id');
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

// EN: Read documented query parameter names from one OpenAPI operation.
// RU: Читает имена задокументированных query параметров одной OpenAPI operation.
function getOpenApiParameterNames(
  paths: Record<string, unknown>,
  path: string,
): string[] {
  const pathItem = paths[path];

  if (!isRecord(pathItem) || !isRecord(pathItem.get)) {
    return [];
  }

  const parameters = pathItem.get.parameters;

  if (!Array.isArray(parameters)) {
    return [];
  }

  return parameters.flatMap((parameter) =>
    isRecord(parameter) && typeof parameter.name === 'string'
      ? [parameter.name]
      : [],
  );
}
