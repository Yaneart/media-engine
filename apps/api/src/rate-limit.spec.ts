import type { Request, Response } from 'express';
import { createRateLimitMiddleware } from './rate-limit';

interface TestResponse {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}

describe('createRateLimitMiddleware', () => {
  it('passes through non-expensive requests and disabled limits', () => {
    const next = jest.fn();
    const response = createResponse();

    createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 })(
      createRequest('POST', '/media/search'),
      response as unknown as Response,
      next,
    );
    createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 0 })(
      createRequest('GET', '/media/search'),
      response as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('limits expensive media routes by remote address and emits retry headers', () => {
    let now = 1_000;
    const next = jest.fn();
    const response = createResponse();
    const middleware = createRateLimitMiddleware({
      windowMs: 10_000,
      maxRequests: 2,
      now: () => now,
    });
    const request = createRequest('GET', '/media/search/', '127.0.0.1');

    middleware(request, response as unknown as Response, next);
    middleware(request, response as unknown as Response, next);
    middleware(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Limit', '2');
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '0');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 429,
      message:
        'Too many media requests. Retry after the current rate-limit window.',
      error: 'Too Many Requests',
    });

    now = 11_000;
    middleware(request, response as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('includes torrent discovery in the shared expensive-media budget', () => {
    const next = jest.fn();
    const response = createResponse();
    const middleware = createRateLimitMiddleware({
      windowMs: 10_000,
      maxRequests: 1,
      now: () => 1_000,
    });
    const request = createRequest('GET', '/media/torrents');

    middleware(request, response as unknown as Response, next);
    middleware(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(429);
  });

  it('supports custom matchers, messages, and an unknown remote address fallback', () => {
    const next = jest.fn();
    const response = createResponse();
    const middleware = createRateLimitMiddleware({
      windowMs: 1_000,
      maxRequests: 1,
      matches: (request) => request.path === '/custom',
      message: 'Custom limit exceeded.',
      now: () => 1_000,
    });
    const request = createRequest('GET', '/custom');

    middleware(request, response as unknown as Response, next);
    middleware(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Custom limit exceeded.',
      error: 'Too Many Requests',
    });
  });
});

function createRequest(
  method: string,
  path: string,
  remoteAddress?: string,
): Request {
  return {
    method,
    path,
    socket: { remoteAddress },
  } as Request;
}

function createResponse(): TestResponse {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}
