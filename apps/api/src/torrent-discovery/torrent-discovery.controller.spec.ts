import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  MediaEngineError,
  type MediaEngine,
  type TorrentDiscoveryResponse,
  type TorrentProviderInfo,
} from '@media-engine/core';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MEDIA_ENGINE } from '../media-engine';
import { TorrentDiscoveryModule } from './torrent-discovery.module';

describe('Torrent discovery HTTP bridge', () => {
  let app: INestApplication<App>;
  let mediaEngine: jest.Mocked<
    Pick<MediaEngine, 'discoverTorrents' | 'getTorrentProviders'>
  >;

  const discovery: TorrentDiscoveryResponse = {
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
  const providers: TorrentProviderInfo[] = [
    {
      name: 'yts-torrent',
      kind: 'torrent',
      capabilities: {
        mediaTypes: ['movie'],
        lookup: {
          byTitle: true,
          byExternalIds: ['imdb'],
          byEpisode: false,
        },
        features: ['magnet', 'torrent_file'],
      },
    },
  ];

  beforeEach(async () => {
    mediaEngine = {
      discoverTorrents: jest.fn().mockResolvedValue(discovery),
      getTorrentProviders: jest.fn().mockReturnValue(providers),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TorrentDiscoveryModule],
    })
      .overrideProvider(MEDIA_ENGINE)
      .useValue(mediaEngine)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('passes a bounded normalized query and cancellation signal to core', async () => {
    await request(app.getHttpServer())
      .get('/media/torrents')
      .query({
        type: 'movie',
        title: ' Dune ',
        providers: 'yts-torrent,jacred-torrent',
        limit: '10',
      })
      .expect(200)
      .expect(discovery);

    expect(mediaEngine.discoverTorrents).toHaveBeenCalledWith(
      {
        type: 'movie',
        title: 'Dune',
        providers: ['yts-torrent', 'jacred-torrent'],
        limit: 10,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('exposes only safe provider metadata', async () => {
    await request(app.getHttpServer())
      .get('/providers/torrent')
      .expect(200)
      .expect(providers);

    expect(mediaEngine.getTorrentProviders).toHaveBeenCalledTimes(1);
  });

  it('maps query and provider failures to stable HTTP statuses', async () => {
    await request(app.getHttpServer())
      .get('/media/torrents?type=movie&title=Dune&limit=101')
      .expect(400);
    expect(mediaEngine.discoverTorrents).not.toHaveBeenCalled();

    mediaEngine.discoverTorrents.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'INVALID_QUERY',
        message: 'Torrent discovery query must include title or external ids.',
      }),
    );
    await request(app.getHttpServer())
      .get('/media/torrents?type=movie')
      .expect(400);

    mediaEngine.discoverTorrents.mockRejectedValueOnce(
      new MediaEngineError({
        code: 'PROVIDER_ERROR',
        message: 'All selected torrent providers failed.',
      }),
    );
    await request(app.getHttpServer())
      .get('/media/torrents?type=movie&title=Dune')
      .expect(503);
  });
});
