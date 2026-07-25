import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ReferencePlaybackController } from './controller';
import { TorrentPlaybackSessionError } from './errors';
import { ReferencePlaybackRuntime } from './runtime';
import { TorrentPlaybackSessionService } from './session-service';
import { ReferencePlaybackTokenGuard } from './token.guard';
import type { TorrentPlaybackSessionSnapshot } from './types';

const SESSION_ID = 's'.repeat(43);
const TOKEN = 'operator-token-that-is-at-least-32-characters';
const SESSION: TorrentPlaybackSessionSnapshot = {
  id: SESSION_ID,
  state: 'ready',
  provider: 'test-torrent',
  candidateId: 'candidate-1',
  infoHash: 'a'.repeat(40),
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:01.000Z',
  expiresAt: '2026-07-25T00:30:00.000Z',
  compatibility: 'direct',
  selectedFile: {
    id: 1,
    path: 'Movie.mp4',
    length: 1_000,
    compatibility: 'direct',
  },
};

describe('ReferencePlaybackController', () => {
  let app: INestApplication<App>;
  let runtime: {
    enabled: boolean;
    authorizeBearer: jest.Mock<boolean, [string | undefined]>;
    health: jest.Mock;
  };
  let sessions: {
    createSession: jest.Mock;
    getSession: jest.Mock;
    stopSession: jest.Mock;
  };

  beforeEach(async () => {
    runtime = {
      enabled: true,
      authorizeBearer: jest.fn((header) => header === `Bearer ${TOKEN}`),
      health: jest.fn().mockResolvedValue({ status: 'ok', version: '141.1' }),
    };
    sessions = {
      createSession: jest.fn().mockResolvedValue(SESSION),
      getSession: jest.fn().mockReturnValue(SESSION),
      stopSession: jest
        .fn()
        .mockResolvedValue({ ...SESSION, state: 'stopped' }),
    };
    const module = await Test.createTestingModule({
      controllers: [ReferencePlaybackController],
      providers: [
        ReferencePlaybackTokenGuard,
        { provide: ReferencePlaybackRuntime, useValue: runtime },
        { provide: TorrentPlaybackSessionService, useValue: sessions },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps health public and separates unavailable status', async () => {
    await request(app.getHttpServer())
      .get('/reference/torrent-playback/health')
      .expect(200)
      .expect({ status: 'ok', version: '141.1' });

    runtime.health.mockResolvedValueOnce({ status: 'unavailable' });
    await request(app.getHttpServer())
      .get('/reference/torrent-playback/health')
      .expect(503)
      .expect({ status: 'unavailable' });
  });

  it('requires the separate bearer token for create, status, and stop', async () => {
    await request(app.getHttpServer())
      .post('/reference/torrent-playback/sessions')
      .send({ provider: 'test-torrent', candidateId: 'candidate-1' })
      .expect('WWW-Authenticate', 'Bearer')
      .expect(401);

    await request(app.getHttpServer())
      .get(`/reference/torrent-playback/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
      .expect(SESSION);
    await request(app.getHttpServer())
      .delete(`/reference/torrent-playback/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
      .expect({ ...SESSION, state: 'stopped' });

    expect(sessions.getSession.mock.calls).toEqual([[SESSION_ID]]);
    expect(sessions.stopSession.mock.calls).toEqual([[SESSION_ID]]);
  });

  it('accepts only provider, candidate ID, and an offered numeric file ID', async () => {
    await request(app.getHttpServer())
      .post('/reference/torrent-playback/sessions')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ provider: 'test-torrent', candidateId: 'candidate-1', fileId: 2 })
      .expect(201)
      .expect(SESSION);

    expect(sessions.createSession.mock.calls[0]?.[0]).toEqual({
      provider: 'test-torrent',
      candidateId: 'candidate-1',
      fileId: 2,
    });
    expect(sessions.createSession.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });

    await request(app.getHttpServer())
      .post('/reference/torrent-playback/sessions')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        provider: 'test-torrent',
        candidateId: 'candidate-1',
        magnet: 'magnet:?xt=forbidden',
      })
      .expect(400);
    expect(sessions.createSession.mock.calls).toHaveLength(1);
  });

  it('returns disabled, not-found, bad-request, and capacity semantics safely', async () => {
    runtime.enabled = false;
    await request(app.getHttpServer())
      .get(`/reference/torrent-playback/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(503);

    runtime.enabled = true;
    sessions.getSession
      .mockImplementationOnce(() => {
        throw new TorrentPlaybackSessionError(
          'session_not_found',
          'Playback session was not found.',
        );
      })
      .mockImplementationOnce(() => {
        throw new TorrentPlaybackSessionError(
          'candidate_identity_mismatch',
          'Candidate is inconsistent.',
        );
      })
      .mockImplementationOnce(() => {
        throw new TorrentPlaybackSessionError(
          'session_capacity_exceeded',
          'Capacity reached.',
        );
      });

    for (const status of [404, 400, 503]) {
      await request(app.getHttpServer())
        .get(`/reference/torrent-playback/sessions/${SESSION_ID}`)
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(status);
    }

    await request(app.getHttpServer())
      .get('/reference/torrent-playback/sessions/short')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(404);
  });
});
