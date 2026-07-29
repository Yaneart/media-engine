import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  OriginalTorrentSessionConflictError,
  OriginalTorrentSessionNotFoundError,
} from './session.errors';
import { OriginalTorrentSessionController } from './session.controller';
import {
  ORIGINAL_TORRENT_SESSION_AUTH_CONFIG,
  OriginalTorrentSessionTokenGuard,
} from './session-auth';
import { OriginalTorrentSessionService } from './session.service';

const SESSION_ID = 'A'.repeat(32);
const TOKEN = 'test-original-torrent-token-123456';
const snapshot = {
  id: SESSION_ID,
  state: 'adding' as const,
  observation: { provider: 'provider-a', id: 'provider-a:opaque' },
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  expiresAt: '2026-07-29T00:30:00.000Z',
};

describe('original torrent session HTTP lifecycle', () => {
  let app: INestApplication<App>;
  let sessions: {
    create: jest.Mock;
    get: jest.Mock;
    selectFile: jest.Mock;
    stop: jest.Mock;
  };

  beforeEach(async () => {
    sessions = {
      create: jest.fn().mockReturnValue(snapshot),
      get: jest.fn().mockResolvedValue(snapshot),
      selectFile: jest.fn().mockResolvedValue({
        ...snapshot,
        state: 'ready',
        files: [{ id: 7, path: 'movie.unusual', length: 100 }],
        selectedFile: { id: 7, path: 'movie.unusual', length: 100 },
      }),
      stop: jest.fn().mockResolvedValue({ ...snapshot, state: 'stopped' }),
    };
    const module = await Test.createTestingModule({
      controllers: [OriginalTorrentSessionController],
      providers: [
        { provide: OriginalTorrentSessionService, useValue: sessions },
        {
          provide: ORIGINAL_TORRENT_SESSION_AUTH_CONFIG,
          useValue: { token: TOKEN },
        },
        OriginalTorrentSessionTokenGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('creates from a media query and opaque observation only', async () => {
    await request(app.getHttpServer())
      .post('/media/torrent-sessions')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        query: { type: 'movie', title: ' Example ', year: 2026 },
        observation: { provider: ' provider-a ', id: ' provider-a:opaque ' },
      })
      .expect(202)
      .expect(snapshot);

    expect(sessions.create).toHaveBeenCalledWith({
      query: { type: 'movie', title: 'Example', year: 2026 },
      observation: { provider: 'provider-a', id: 'provider-a:opaque' },
    });
  });

  it('rejects browser-controlled torrent source and target fields', async () => {
    await request(app.getHttpServer())
      .post('/media/torrent-sessions')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        query: { type: 'movie' },
        observation: { provider: 'provider-a', id: 'provider-a:opaque' },
        magnet: 'magnet:?xt=urn:btih:raw',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/media/torrent-sessions/${SESSION_ID}/selection`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ fileId: 7, path: '../../internal', playUrl: 'http://torrserver' })
      .expect(400);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(sessions.selectFile).not.toHaveBeenCalled();
  });

  it('reads, selects, and stops through exact bounded routes', async () => {
    await request(app.getHttpServer())
      .get(`/media/torrent-sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
      .expect(snapshot);
    await request(app.getHttpServer())
      .post(`/media/torrent-sessions/${SESSION_ID}/selection`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ fileId: 7 })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ state: 'ready' });
      });
    await request(app.getHttpServer())
      .delete(`/media/torrent-sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(204)
      .expect('');

    expect(sessions.get).toHaveBeenCalledWith(SESSION_ID);
    expect(sessions.selectFile).toHaveBeenCalledWith(SESSION_ID, 7);
    expect(sessions.stop).toHaveBeenCalledWith(SESSION_ID);
  });

  it('maps invalid IDs, missing sessions, and state conflicts', async () => {
    await request(app.getHttpServer())
      .get('/media/torrent-sessions/not-valid')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(400);

    sessions.get.mockRejectedValueOnce(
      new OriginalTorrentSessionNotFoundError(),
    );
    await request(app.getHttpServer())
      .get(`/media/torrent-sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(404);

    sessions.selectFile.mockRejectedValueOnce(
      new OriginalTorrentSessionConflictError(
        'torrent_file_not_found',
        'The file was not offered.',
      ),
    );
    await request(app.getHttpServer())
      .post(`/media/torrent-sessions/${SESSION_ID}/selection`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ fileId: 8 })
      .expect(409)
      .expect({
        statusCode: 409,
        code: 'torrent_file_not_found',
        message: 'The file was not offered.',
        error: 'Conflict',
      });
  });

  it('rejects direct browser requests without the server token', async () => {
    await request(app.getHttpServer())
      .post('/media/torrent-sessions')
      .send({
        query: { type: 'movie', title: 'Example' },
        observation: { provider: 'provider-a', id: 'provider-a:opaque' },
      })
      .expect('WWW-Authenticate', 'Bearer')
      .expect(401);

    expect(sessions.create).not.toHaveBeenCalled();
  });
});
