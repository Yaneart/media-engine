import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { OriginalTorrentStreamCapabilityError } from '../original-torrent-session/session.errors';
import {
  OriginalTorrentStreamCapacityError,
  OriginalTorrentUpstreamStreamError,
} from './stream.errors';
import { OriginalTorrentStreamGateway } from './stream-gateway';
import { OriginalTorrentRangeInputError } from './stream-range';
import { OriginalTorrentStreamController } from './stream.controller';

const CAPABILITY = 'A'.repeat(43);

describe('original torrent stream HTTP controller', () => {
  let app: INestApplication<App>;
  let gateway: { handle: jest.Mock };

  beforeEach(async () => {
    gateway = {
      handle: jest.fn((_request, response: Response, _capability, method) => {
        response.status(200);
        response.setHeader('Content-Length', method === 'HEAD' ? '0' : '2');
        response.end(method === 'HEAD' ? undefined : 'ok');
        return Promise.resolve();
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [OriginalTorrentStreamController],
      providers: [{ provide: OriginalTorrentStreamGateway, useValue: gateway }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('routes explicit HEAD before GET and preserves the opaque capability', async () => {
    await request(app.getHttpServer())
      .head(`/media/torrent-streams/${CAPABILITY}`)
      .expect(200)
      .expect('Content-Length', '0');
    expect(gateway.handle).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      CAPABILITY,
      'HEAD',
    );

    await request(app.getHttpServer())
      .get(`/media/torrent-streams/${CAPABILITY}`)
      .expect(200)
      .expect('ok');
    expect(gateway.handle).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      CAPABILITY,
      'GET',
    );
  });

  it('rejects malformed capability tokens before gateway access', async () => {
    await request(app.getHttpServer())
      .get('/media/torrent-streams/not-a-capability')
      .expect(400);
    expect(gateway.handle).not.toHaveBeenCalled();
  });

  it('maps range and retired capability errors to stable HTTP responses', async () => {
    gateway.handle.mockRejectedValueOnce(
      new OriginalTorrentRangeInputError('One range only.'),
    );
    await request(app.getHttpServer())
      .get(`/media/torrent-streams/${CAPABILITY}`)
      .expect(400);

    gateway.handle.mockRejectedValueOnce(
      new OriginalTorrentStreamCapabilityError(
        'session_stopped',
        'Session stopped.',
        false,
      ),
    );
    await request(app.getHttpServer())
      .get(`/media/torrent-streams/${CAPABILITY}`)
      .expect(410)
      .expect({
        statusCode: 410,
        code: 'session_stopped',
        message: 'Session stopped.',
        error: 'Gone',
      });
  });

  it.each([
    ['torrent_pieces_unavailable' as const, true, 503, 'Service Unavailable'],
    ['torrent_stream_failed' as const, false, 502, 'Bad Gateway'],
  ])(
    'maps %s upstream failures without exposing an internal target',
    async (code, transient, status, label) => {
      gateway.handle.mockRejectedValueOnce(
        new OriginalTorrentUpstreamStreamError(
          { code, message: 'Safe stream failure.', transient },
          transient,
        ),
      );
      await request(app.getHttpServer())
        .get(`/media/torrent-streams/${CAPABILITY}`)
        .expect(status)
        .expect({
          statusCode: status,
          code,
          message: 'Safe stream failure.',
          error: label,
        });
    },
  );

  it('maps exhausted stream capacity without retiring the capability', async () => {
    gateway.handle.mockRejectedValueOnce(
      new OriginalTorrentStreamCapacityError(),
    );

    await request(app.getHttpServer())
      .get(`/media/torrent-streams/${CAPABILITY}`)
      .expect(503)
      .expect({
        statusCode: 503,
        code: 'torrent_stream_capacity_exceeded',
        message: 'The original torrent stream capacity is exhausted.',
        error: 'Service Unavailable',
      });
  });
});
